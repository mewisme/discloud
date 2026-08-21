package discordstore

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/mewisme/discloud/internal/blobstore"
)

var benchmarkRuntimeSnapshot SchedulerRuntimeSnapshot

func BenchmarkSchedulerAcquireRelease(b *testing.B) {
	for _, botCount := range []int{1, 2, 4, 8, 16} {
		b.Run("bots="+strconv.Itoa(botCount), func(b *testing.B) {
			scheduler := NewScheduler(benchmarkBots(botCount))
			ctx := context.Background()

			b.ReportAllocs()
			b.ResetTimer()

			for b.Loop() {
				bot, release, err := scheduler.Acquire(ctx, nil, blobstore.LeaseMetadata{
					Operation: blobstore.LeaseOperationUpload,
				})
				if err != nil {
					b.Fatalf("Acquire(): %v", err)
				}
				if bot.UserID == "" {
					b.Fatal("Acquire() returned empty bot ID")
				}
				release()
			}
		})
	}
}

func BenchmarkSchedulerMixedContention(b *testing.B) {
	operations := [...]blobstore.LeaseOperation{
		blobstore.LeaseOperationUpload,
		blobstore.LeaseOperationResolve,
		blobstore.LeaseOperationDelete,
		blobstore.LeaseOperationMaintenance,
	}

	for _, botCount := range []int{1, 2, 4, 8, 16} {
		b.Run("bots="+strconv.Itoa(botCount), func(b *testing.B) {
			scheduler := NewScheduler(benchmarkBots(botCount))
			ctx := context.Background()
			var sequence atomic.Uint64
			errs := make(chan error, 1)

			b.ReportAllocs()
			b.ResetTimer()

			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					index := (sequence.Add(1) - 1) % uint64(len(operations))
					operation := operations[index]

					bot, release, err := scheduler.Acquire(ctx, nil, blobstore.LeaseMetadata{
						Operation: operation,
					})
					if err != nil {
						select {
						case errs <- err:
						default:
						}
						return
					}
					if bot.UserID == "" {
						select {
						case errs <- fmt.Errorf("Acquire() returned empty bot ID"):
						default:
						}
						release()
						return
					}

					runtime.Gosched()
					release()
				}
			})

			b.StopTimer()

			select {
			case err := <-errs:
				b.Fatal(err)
			default:
			}
		})
	}
}

func BenchmarkSchedulerRuntimeSnapshot(b *testing.B) {
	for _, botCount := range []int{1, 2, 4, 8, 16} {
		b.Run("bots="+strconv.Itoa(botCount), func(b *testing.B) {
			scheduler := NewScheduler(benchmarkBots(botCount))
			releases := make([]func(), 0, botCount/2)

			for index := 0; index < botCount/2; index++ {
				_, release, err := scheduler.Acquire(context.Background(), nil, blobstore.LeaseMetadata{
					Operation: blobstore.LeaseOperationUpload,
				})
				if err != nil {
					b.Fatalf("Acquire(): %v", err)
				}
				releases = append(releases, release)
			}

			b.Cleanup(func() {
				for _, release := range releases {
					release()
				}
			})

			b.ReportAllocs()
			b.ResetTimer()

			for b.Loop() {
				benchmarkRuntimeSnapshot = scheduler.ControlledSnapshot()
			}
		})
	}
}

func benchmarkBots(count int) []Bot {
	bots := make([]Bot, count)

	for index := range bots {
		id := strconv.Itoa(index + 1)
		bots[index] = Bot{
			UserID:      id,
			Username:    "bot-" + id,
			DisplayName: "Bot " + id,
		}
	}

	return bots
}
