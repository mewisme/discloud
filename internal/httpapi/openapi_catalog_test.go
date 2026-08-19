package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type openAPICatalogPointers struct {
	ErrorMatrix string `json:"x-discloud-error-matrix"`
	Examples    string `json:"x-discloud-examples"`
}

type openAPIErrorCatalog struct {
	Version          int               `json:"version"`
	ProblemMediaType string            `json:"problemMediaType"`
	Statuses         map[string]string `json:"statuses"`
	Operations       map[string][]int  `json:"operations"`
}

type openAPIExampleCatalog struct {
	Version  int              `json:"version"`
	Examples []openAPIExample `json:"examples"`
}

type openAPIExample struct {
	Name        string                 `json:"name"`
	OperationID string                 `json:"operationId"`
	Request     *openAPIExampleMessage `json:"request,omitempty"`
	Response    openAPIExampleResponse `json:"response"`
}

type openAPIExampleMessage struct {
	ContentType     string            `json:"contentType,omitempty"`
	Headers         map[string]string `json:"headers,omitempty"`
	Query           map[string]string `json:"query,omitempty"`
	Body            json.RawMessage   `json:"body,omitempty"`
	BodyDescription string            `json:"bodyDescription,omitempty"`
}

type openAPIExampleResponse struct {
	Status          int               `json:"status"`
	ContentType     string            `json:"contentType,omitempty"`
	Headers         map[string]string `json:"headers,omitempty"`
	Body            json.RawMessage   `json:"body,omitempty"`
	BodyDescription string            `json:"bodyDescription,omitempty"`
}

type openAPICatalogOperation struct {
	Route     openAPIRoute
	Operation openAPIOperation
}

func TestOpenAPIErrorMatrixCoversOperations(t *testing.T) {
	repoRoot, pointers, operations := openAPICatalogContext(t)
	catalog := openAPILoadErrorCatalog(t, repoRoot, pointers.ErrorMatrix)

	if catalog.Version != 1 {
		t.Fatalf("error catalog version = %d, want 1", catalog.Version)
	}
	if catalog.ProblemMediaType != "application/problem+json" {
		t.Fatalf(
			"problem media type = %q, want application/problem+json",
			catalog.ProblemMediaType,
		)
	}
	if len(catalog.Operations) != len(operations) {
		t.Fatalf(
			"error matrix has %d operations, OpenAPI has %d",
			len(catalog.Operations),
			len(operations),
		)
	}

	publicRoutes := openAPIPublicRoutes()

	for operationID, entry := range operations {
		statuses, exists := catalog.Operations[operationID]
		if !exists {
			t.Errorf("operation %q is missing from error matrix", operationID)
			continue
		}

		if _, exists := entry.Operation.Responses["default"]; !exists {
			t.Errorf(
				"%s %s has no default Problem response",
				entry.Route.Method,
				entry.Route.Path,
			)
		}

		openAPIAssertErrorStatuses(t, catalog, operationID, statuses)

		_, public := publicRoutes[entry.Route]
		if !public && !openAPIHasStatus(statuses, 401) {
			t.Errorf(
				"%s %s is authenticated but does not document 401",
				entry.Route.Method,
				entry.Route.Path,
			)
		}

		if openAPIUnsafeMethod(entry.Route.Method) &&
			!openAPIHasStatus(statuses, 403) {
			t.Errorf(
				"%s %s is CSRF-protected but does not document 403",
				entry.Route.Method,
				entry.Route.Path,
			)
		}

		if strings.HasPrefix(entry.Route.Path, "/api/v1/admin/") &&
			!openAPIHasStatus(statuses, 403) {
			t.Errorf(
				"%s %s is admin-only but does not document 403",
				entry.Route.Method,
				entry.Route.Path,
			)
		}
	}

	for operationID := range catalog.Operations {
		if _, exists := operations[operationID]; !exists {
			t.Errorf(
				"error matrix contains unknown operationId %q",
				operationID,
			)
		}
	}

	for status, description := range catalog.Statuses {
		code, err := strconv.Atoi(status)
		if err != nil || code < 400 || code > 599 {
			t.Errorf("invalid documented error status %q", status)
		}
		if strings.TrimSpace(description) == "" {
			t.Errorf("error status %q has no description", status)
		}
	}
}

func TestOpenAPIExamplesReferenceDocumentedContracts(t *testing.T) {
	repoRoot, pointers, operations := openAPICatalogContext(t)
	errors := openAPILoadErrorCatalog(t, repoRoot, pointers.ErrorMatrix)

	var catalog openAPIExampleCatalog
	openAPIReadCatalogJSON(
		t,
		openAPICatalogPath(repoRoot, pointers.Examples),
		&catalog,
	)

	if catalog.Version != 1 {
		t.Fatalf("example catalog version = %d, want 1", catalog.Version)
	}
	if len(catalog.Examples) < 10 {
		t.Fatalf(
			"example catalog has %d examples, want at least 10",
			len(catalog.Examples),
		)
	}

	names := make(map[string]bool)

	for _, example := range catalog.Examples {
		if strings.TrimSpace(example.Name) == "" {
			t.Error("example has no name")
			continue
		}
		if names[example.Name] {
			t.Errorf("duplicate example name %q", example.Name)
		}
		names[example.Name] = true

		entry, exists := operations[example.OperationID]
		if !exists {
			t.Errorf(
				"example %q references unknown operationId %q",
				example.Name,
				example.OperationID,
			)
			continue
		}

		if example.Response.Status < 100 ||
			example.Response.Status > 599 {
			t.Errorf(
				"example %q has invalid response status %d",
				example.Name,
				example.Response.Status,
			)
			continue
		}

		if example.Response.Status >= 400 {
			statuses := errors.Operations[example.OperationID]
			if !openAPIHasStatus(
				statuses,
				example.Response.Status,
			) {
				t.Errorf(
					"example %q uses undocumented error status %d",
					example.Name,
					example.Response.Status,
				)
			}
			openAPIAssertProblemExample(t, example)
		} else {
			status := strconv.Itoa(example.Response.Status)
			if _, exists := entry.Operation.Responses[status]; !exists {
				t.Errorf(
					"example %q uses success status %s not documented by %s %s",
					example.Name,
					status,
					entry.Route.Method,
					entry.Route.Path,
				)
			}
		}

		if len(example.Response.Body) > 0 &&
			example.Response.ContentType == "" {
			t.Errorf(
				"example %q has response body without contentType",
				example.Name,
			)
		}

		if example.Request != nil {
			openAPIAssertNoCredentialHeaders(
				t,
				example.Name,
				example.Request.Headers,
			)
		}
		openAPIAssertNoCredentialHeaders(
			t,
			example.Name,
			example.Response.Headers,
		)
	}
}

func openAPICatalogContext(
	t *testing.T,
) (
	string,
	openAPICatalogPointers,
	map[string]openAPICatalogOperation,
) {
	t.Helper()

	_, repoRoot := openAPIRepoPaths(t)
	rootPath := filepath.Join(repoRoot, "docs", "openapi.json")

	var pointers openAPICatalogPointers
	openAPIReadCatalogJSON(t, rootPath, &pointers)

	if pointers.ErrorMatrix != "./openapi/errors.json" {
		t.Fatalf(
			"x-discloud-error-matrix = %q",
			pointers.ErrorMatrix,
		)
	}
	if pointers.Examples != "./openapi/examples.json" {
		t.Fatalf(
			"x-discloud-examples = %q",
			pointers.Examples,
		)
	}

	var document openAPIContract
	openAPIReadCatalogJSON(t, rootPath, &document)

	_, byRoute, err := openAPISpecRoutes(document)
	if err != nil {
		t.Fatalf("read OpenAPI operations: %v", err)
	}

	byID := make(map[string]openAPICatalogOperation, len(byRoute))
	for route, operation := range byRoute {
		if operation.OperationID == "" {
			continue
		}
		byID[operation.OperationID] = openAPICatalogOperation{
			Route:     route,
			Operation: operation,
		}
	}

	return repoRoot, pointers, byID
}

func openAPILoadErrorCatalog(
	t *testing.T,
	repoRoot string,
	path string,
) openAPIErrorCatalog {
	t.Helper()

	var catalog openAPIErrorCatalog
	openAPIReadCatalogJSON(
		t,
		openAPICatalogPath(repoRoot, path),
		&catalog,
	)
	return catalog
}

func openAPICatalogPath(repoRoot, relative string) string {
	relative = strings.TrimPrefix(relative, "./")
	return filepath.Join(
		repoRoot,
		"docs",
		filepath.FromSlash(relative),
	)
}

func openAPIReadCatalogJSON(
	t *testing.T,
	path string,
	target any,
) {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

func openAPIAssertErrorStatuses(
	t *testing.T,
	catalog openAPIErrorCatalog,
	operationID string,
	statuses []int,
) {
	t.Helper()

	for index, status := range statuses {
		if status < 400 || status > 599 {
			t.Errorf(
				"operation %q has invalid error status %d",
				operationID,
				status,
			)
		}

		if index > 0 && status <= statuses[index-1] {
			t.Errorf(
				"operation %q error statuses are not strictly ascending: %v",
				operationID,
				statuses,
			)
		}

		if _, exists := catalog.Statuses[strconv.Itoa(status)]; !exists {
			t.Errorf(
				"operation %q uses error status %d without a catalog description",
				operationID,
				status,
			)
		}
	}
}

func openAPIAssertProblemExample(
	t *testing.T,
	example openAPIExample,
) {
	t.Helper()

	if example.Response.ContentType != "application/problem+json" {
		t.Errorf(
			"error example %q contentType = %q",
			example.Name,
			example.Response.ContentType,
		)
		return
	}
	if len(example.Response.Body) == 0 {
		t.Errorf("error example %q has no Problem body", example.Name)
		return
	}

	var problem Problem
	if err := json.Unmarshal(example.Response.Body, &problem); err != nil {
		t.Errorf(
			"error example %q has invalid Problem body: %v",
			example.Name,
			err,
		)
		return
	}

	if problem.Status != example.Response.Status {
		t.Errorf(
			"error example %q Problem status = %d, response status = %d",
			example.Name,
			problem.Status,
			example.Response.Status,
		)
	}
	if strings.TrimSpace(problem.Title) == "" {
		t.Errorf("error example %q has empty Problem title", example.Name)
	}
}

func openAPIAssertNoCredentialHeaders(
	t *testing.T,
	exampleName string,
	headers map[string]string,
) {
	t.Helper()

	for header := range headers {
		switch {
		case strings.EqualFold(header, "Cookie"),
			strings.EqualFold(header, "Set-Cookie"),
			strings.EqualFold(header, "Authorization"):
			t.Errorf(
				"example %q must not contain credential header %q",
				exampleName,
				header,
			)
		}
	}
}

func openAPIHasStatus(statuses []int, want int) bool {
	for _, status := range statuses {
		if status == want {
			return true
		}
	}
	return false
}

func openAPIUnsafeMethod(method string) bool {
	switch method {
	case "POST", "PUT", "PATCH", "DELETE":
		return true
	default:
		return false
	}
}
