package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/discordstore"
)

const (
	botRuntimeSSEVersion   = 1
	botRuntimeSSEBuffer    = 128
	botRuntimeSSEHeartbeat = 15 * time.Second
	discordAvatarSize      = 128
)

type BotRuntimeProvider interface {
	RuntimeSnapshot() discordstore.SchedulerRuntimeSnapshot
	RuntimeEventsSince(after uint64) discordstore.RuntimeEventWindow
	SubscribeRuntime(buffer int) (<-chan discordstore.RuntimeEvent, func())
}

type adminBotRuntimeResponse struct {
	GeneratedAt   time.Time                       `json:"generatedAt"`
	Summary       adminBotRuntimeSummary          `json:"summary"`
	Queues        map[string]adminBotRuntimeQueue `json:"queues"`
	Bots          []adminBotRuntimeBot            `json:"bots"`
	LatestEventID uint64                          `json:"latestEventId"`
}

type adminBotRuntimeSummary struct {
	Configured        int `json:"configured"`
	EffectiveCapacity int `json:"effectiveCapacity"`
	AvailableNow      int `json:"availableNow"`
	Working           int `json:"working"`
	Idle              int `json:"idle"`
	Cooldown          int `json:"cooldown"`
	ActiveLeases      int `json:"activeLeases"`
	TotalWaiting      int `json:"totalWaiting"`
}

type adminBotRuntimeQueue struct {
	Depth        int   `json:"depth"`
	OldestWaitMS int64 `json:"oldestWaitMs"`
}

type adminBotRuntimeBot struct {
	ID            string                 `json:"id"`
	Username      string                 `json:"username"`
	DisplayName   string                 `json:"displayName"`
	AvatarURL     string                 `json:"avatarUrl,omitempty"`
	State         string                 `json:"state"`
	Working       bool                   `json:"working"`
	Cooling       bool                   `json:"cooling"`
	CooldownUntil *time.Time             `json:"cooldownUntil,omitempty"`
	Lease         *adminBotRuntimeLease  `json:"lease,omitempty"`
	Metrics       adminBotRuntimeMetrics `json:"metrics"`
}

type adminBotRuntimeLease struct {
	Operation  string    `json:"operation"`
	StartedAt  time.Time `json:"startedAt"`
	DurationMS int64     `json:"durationMs"`
	UploadID   string    `json:"uploadId,omitempty"`
	ResourceID string    `json:"resourceId,omitempty"`
	FileName   string    `json:"fileName,omitempty"`
	PartIndex  *int      `json:"partIndex,omitempty"`
	SizeBytes  int64     `json:"sizeBytes"`
}

type adminBotRuntimeMetrics struct {
	OperationsSucceeded          uint64     `json:"operationsSucceeded"`
	OperationsFailed             uint64     `json:"operationsFailed"`
	RateLimitedCount             uint64     `json:"rateLimitedCount"`
	BytesTransferred             int64      `json:"bytesTransferred"`
	LastSuccessAt                *time.Time `json:"lastSuccessAt,omitempty"`
	LastErrorAt                  *time.Time `json:"lastErrorAt,omitempty"`
	LastErrorClass               string     `json:"lastErrorClass,omitempty"`
	LastErrorMessage             string     `json:"lastErrorMessage,omitempty"`
	LastOperationDurationMS      int64      `json:"lastOperationDurationMs"`
	LastThroughputBytesPerSecond float64    `json:"lastThroughputBytesPerSecond"`
}

type adminBotRuntimeEvent struct {
	ID            uint64     `json:"id"`
	Type          string     `json:"type"`
	At            time.Time  `json:"at"`
	BotID         string     `json:"botId,omitempty"`
	Operation     string     `json:"operation,omitempty"`
	UploadID      string     `json:"uploadId,omitempty"`
	ResourceID    string     `json:"resourceId,omitempty"`
	FileName      string     `json:"fileName,omitempty"`
	PartIndex     *int       `json:"partIndex,omitempty"`
	SizeBytes     int64      `json:"sizeBytes,omitempty"`
	DurationMS    int64      `json:"durationMs,omitempty"`
	QueueDepth    int        `json:"queueDepth,omitempty"`
	CooldownUntil *time.Time `json:"cooldownUntil,omitempty"`
	ErrorClass    string     `json:"errorClass,omitempty"`
	Message       string     `json:"message,omitempty"`
}

type botRuntimeSSEControl struct {
	Version       int    `json:"version"`
	LatestEventID uint64 `json:"latestEventId"`
}

func registerAdminBotRoutes(
	mux *http.ServeMux,
	provider BotRuntimeProvider,
	authService *auth.Service,
	cfg config.AuthConfig,
) {
	admin := func(pattern string, handler http.Handler) {
		mux.Handle(pattern, requireAdmin(authService, cfg, handler))
	}

	admin("GET /api/v1/admin/bots", botRuntimeSnapshotHandler(provider))
	admin("GET /api/v1/admin/bots/events", botRuntimeEventsHandler(provider))
}

func botRuntimeSnapshotHandler(provider BotRuntimeProvider) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(projectBotRuntimeSnapshot(provider.RuntimeSnapshot()))
	})
}

func botRuntimeEventsHandler(provider BotRuntimeProvider) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastEventID, err := parseLastEventID(r.Header.Get("Last-Event-ID"))
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid Last-Event-ID")
			return
		}

		events, unsubscribe := provider.SubscribeRuntime(botRuntimeSSEBuffer)
		defer unsubscribe()

		window := provider.RuntimeEventsSince(lastEventID)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		controller := http.NewResponseController(w)

		if err := writeRuntimeSSEJSON(w, "ready", 0, botRuntimeSSEControl{
			Version:       botRuntimeSSEVersion,
			LatestEventID: window.LatestID,
		}); err != nil {
			return
		}

		lastSentID := lastEventID

		if runtimeReplayGap(lastEventID, window) {
			if err := writeRuntimeSSEJSON(w, "reset", 0, botRuntimeSSEControl{
				Version:       botRuntimeSSEVersion,
				LatestEventID: window.LatestID,
			}); err != nil {
				return
			}
			lastSentID = window.LatestID
		} else {
			for _, event := range window.Events {
				if event.ID <= lastSentID {
					continue
				}
				if err := writeRuntimeSSEJSON(
					w,
					string(event.Type),
					event.ID,
					projectBotRuntimeEvent(event),
				); err != nil {
					return
				}
				lastSentID = event.ID
			}
		}

		if err := controller.Flush(); err != nil {
			return
		}

		heartbeat := time.NewTicker(botRuntimeSSEHeartbeat)
		defer heartbeat.Stop()

		for {
			select {
			case <-r.Context().Done():
				return

			case event, ok := <-events:
				if !ok {
					return
				}
				if event.ID <= lastSentID {
					continue
				}

				if lastSentID > 0 &&
					event.ID > lastSentID &&
					event.ID-lastSentID > 1 {
					if err := writeRuntimeSSEJSON(w, "reset", 0, botRuntimeSSEControl{
						Version:       botRuntimeSSEVersion,
						LatestEventID: event.ID,
					}); err != nil {
						return
					}
					lastSentID = event.ID

					if err := controller.Flush(); err != nil {
						return
					}
					continue
				}

				if err := writeRuntimeSSEJSON(
					w,
					string(event.Type),
					event.ID,
					projectBotRuntimeEvent(event),
				); err != nil {
					return
				}

				lastSentID = event.ID

				if err := controller.Flush(); err != nil {
					return
				}

			case <-heartbeat.C:
				if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
					return
				}
				if err := controller.Flush(); err != nil {
					return
				}
			}
		}
	})
}

func projectBotRuntimeSnapshot(
	snapshot discordstore.SchedulerRuntimeSnapshot,
) adminBotRuntimeResponse {
	queues := make(map[string]adminBotRuntimeQueue, len(snapshot.Queues))
	for operation, queue := range snapshot.Queues {
		queues[string(operation)] = adminBotRuntimeQueue{
			Depth:        queue.Depth,
			OldestWaitMS: durationMilliseconds(queue.OldestWait),
		}
	}

	bots := make([]adminBotRuntimeBot, 0, len(snapshot.Bots))
	for _, bot := range snapshot.Bots {
		bots = append(bots, projectBotRuntimeBot(bot))
	}

	return adminBotRuntimeResponse{
		GeneratedAt: snapshot.GeneratedAt,
		Summary: adminBotRuntimeSummary{
			Configured:        snapshot.Capacity.Configured,
			EffectiveCapacity: snapshot.Capacity.Effective,
			AvailableNow:      snapshot.Capacity.Available,
			Working:           snapshot.Working,
			Idle:              snapshot.Idle,
			Cooldown:          snapshot.Cooldown,
			ActiveLeases:      snapshot.ActiveLeases,
			TotalWaiting:      snapshot.TotalWaiting,
		},
		Queues:        queues,
		Bots:          bots,
		LatestEventID: snapshot.LatestEventID,
	}
}

func projectBotRuntimeBot(bot discordstore.RuntimeBot) adminBotRuntimeBot {
	result := adminBotRuntimeBot{
		ID:            bot.UserID,
		Username:      bot.Username,
		DisplayName:   bot.DisplayName,
		AvatarURL:     discordBotAvatarURL(bot.UserID, bot.Avatar),
		State:         string(bot.State),
		Working:       bot.Working,
		Cooling:       bot.Cooling,
		CooldownUntil: bot.CooldownUntil,
		Metrics: adminBotRuntimeMetrics{
			OperationsSucceeded:          bot.Metrics.OperationsSucceeded,
			OperationsFailed:             bot.Metrics.OperationsFailed,
			RateLimitedCount:             bot.Metrics.RateLimitedCount,
			BytesTransferred:             bot.Metrics.BytesTransferred,
			LastSuccessAt:                bot.Metrics.LastSuccessAt,
			LastErrorAt:                  bot.Metrics.LastErrorAt,
			LastErrorClass:               string(bot.Metrics.LastErrorClass),
			LastErrorMessage:             bot.Metrics.LastErrorMessage,
			LastOperationDurationMS:      durationMilliseconds(bot.Metrics.LastOperationDuration),
			LastThroughputBytesPerSecond: bot.Metrics.LastThroughputBytesPerSecond,
		},
	}

	if bot.Lease != nil {
		result.Lease = &adminBotRuntimeLease{
			Operation:  string(bot.Lease.Operation),
			StartedAt:  bot.Lease.StartedAt,
			DurationMS: durationMilliseconds(bot.Lease.Duration),
			UploadID:   bot.Lease.UploadID,
			ResourceID: bot.Lease.ResourceID,
			FileName:   bot.Lease.FileName,
			PartIndex:  bot.Lease.PartIndex,
			SizeBytes:  bot.Lease.SizeBytes,
		}
	}

	return result
}

func projectBotRuntimeEvent(event discordstore.RuntimeEvent) adminBotRuntimeEvent {
	return adminBotRuntimeEvent{
		ID:            event.ID,
		Type:          string(event.Type),
		At:            event.At,
		BotID:         event.BotUserID,
		Operation:     string(event.Operation),
		UploadID:      event.UploadID,
		ResourceID:    event.ResourceID,
		FileName:      event.FileName,
		PartIndex:     event.PartIndex,
		SizeBytes:     event.SizeBytes,
		DurationMS:    durationMilliseconds(event.Duration),
		QueueDepth:    event.QueueDepth,
		CooldownUntil: event.CooldownUntil,
		ErrorClass:    string(event.ErrorClass),
		Message:       event.Message,
	}
}

func discordBotAvatarURL(userID, avatar string) string {
	userID = strings.TrimSpace(userID)
	avatar = strings.TrimSpace(avatar)
	if userID == "" || avatar == "" {
		return ""
	}

	return "https://cdn.discordapp.com/avatars/" +
		url.PathEscape(userID) + "/" +
		url.PathEscape(avatar) +
		".png?size=" + strconv.Itoa(discordAvatarSize)
}

func parseLastEventID(value string) (uint64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}

	return strconv.ParseUint(value, 10, 64)
}

func runtimeReplayGap(
	after uint64,
	window discordstore.RuntimeEventWindow,
) bool {
	if after == 0 {
		return false
	}
	if window.LatestID < after {
		return true
	}
	if window.OldestID == 0 || window.OldestID <= after {
		return false
	}

	return window.OldestID-after > 1
}

func writeRuntimeSSEJSON(
	w http.ResponseWriter,
	eventName string,
	id uint64,
	value any,
) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}

	if id > 0 {
		if _, err := fmt.Fprintf(w, "id: %d\n", id); err != nil {
			return err
		}
	}

	if eventName != "" {
		if _, err := fmt.Fprintf(w, "event: %s\n", eventName); err != nil {
			return err
		}
	}

	_, err = fmt.Fprintf(w, "data: %s\n\n", payload)
	return err
}

func durationMilliseconds(value time.Duration) int64 {
	if value <= 0 {
		return 0
	}
	return value.Milliseconds()
}
