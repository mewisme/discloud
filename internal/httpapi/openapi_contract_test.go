package httpapi

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

var (
	openAPIRoutePattern  = regexp.MustCompile(`^(GET|POST|PUT|PATCH|DELETE|HEAD) (/.+)$`)
	openAPIPathParameter = regexp.MustCompile(`\{([^{}]+)\}`)
)

type openAPIRoute struct {
	Method string
	Path   string
}

type openAPIContract struct {
	OpenAPI  string                                `json:"openapi"`
	Security []map[string][]string                 `json:"security"`
	Paths    map[string]map[string]json.RawMessage `json:"paths"`
}

type openAPIOperation struct {
	Tags        []string                   `json:"tags"`
	OperationID string                     `json:"operationId"`
	Security    json.RawMessage            `json:"security"`
	Parameters  []json.RawMessage          `json:"parameters"`
	Responses   map[string]json.RawMessage `json:"responses"`
}

func TestOpenAPIContractMatchesRouter(t *testing.T) {
	httpapiDir, repoRoot := openAPIRepoPaths(t)

	sourceRoutes, err := openAPISourceRoutes(httpapiDir)
	if err != nil {
		t.Fatalf("read source routes: %v", err)
	}

	rootPath := filepath.Join(repoRoot, "docs", "openapi.json")
	componentsPath := filepath.Join(repoRoot, "docs", "openapi", "components.json")

	rootData, err := os.ReadFile(rootPath)
	if err != nil {
		t.Fatalf("read %s: %v", rootPath, err)
	}
	componentsData, err := os.ReadFile(componentsPath)
	if err != nil {
		t.Fatalf("read %s: %v", componentsPath, err)
	}

	var document openAPIContract
	if err := json.Unmarshal(rootData, &document); err != nil {
		t.Fatalf("parse openapi.json: %v", err)
	}
	if document.OpenAPI != "3.1.2" {
		t.Fatalf("openapi version = %q, want 3.1.2", document.OpenAPI)
	}
	if !hasSessionCookieSecurity(document.Security) {
		t.Fatal("root OpenAPI security does not require sessionCookie")
	}

	var root any
	if err := json.Unmarshal(rootData, &root); err != nil {
		t.Fatalf("parse root document: %v", err)
	}

	var components any
	if err := json.Unmarshal(componentsData, &components); err != nil {
		t.Fatalf("parse components document: %v", err)
	}

	specRoutes, operations, err := openAPISpecRoutes(document)
	if err != nil {
		t.Fatalf("read OpenAPI operations: %v", err)
	}

	if err := compareOpenAPIRoutes(sourceRoutes, specRoutes); err != nil {
		t.Fatal(err)
	}

	publicRoutes := openAPIPublicRoutes()
	operationIDs := make(map[string]openAPIRoute)

	for route, operation := range operations {
		if len(operation.Tags) == 0 {
			t.Errorf("%s %s has no tags", route.Method, route.Path)
		}
		if operation.OperationID == "" {
			t.Errorf("%s %s has no operationId", route.Method, route.Path)
		} else if previous, exists := operationIDs[operation.OperationID]; exists {
			t.Errorf(
				"operationId %q is used by both %s %s and %s %s",
				operation.OperationID,
				previous.Method,
				previous.Path,
				route.Method,
				route.Path,
			)
		} else {
			operationIDs[operation.OperationID] = route
		}
		if len(operation.Responses) == 0 {
			t.Errorf("%s %s has no responses", route.Method, route.Path)
		}

		_, public := publicRoutes[route]
		securityPresent := operation.Security != nil
		if public {
			if !securityPresent {
				t.Errorf("%s %s must explicitly disable global security", route.Method, route.Path)
			} else if !isEmptySecurity(operation.Security) {
				t.Errorf("%s %s must use security: []", route.Method, route.Path)
			}
		} else if securityPresent && isEmptySecurity(operation.Security) {
			t.Errorf("%s %s unexpectedly disables authentication", route.Method, route.Path)
		}

		assertOpenAPIPathParameters(t, route, operation, root, components)
	}

	if len(publicRoutes) != 17 {
		t.Fatalf("public route guard has %d routes, want 17", len(publicRoutes))
	}
}

func TestOpenAPIReferencesResolve(t *testing.T) {
	_, repoRoot := openAPIRepoPaths(t)

	rootData, err := os.ReadFile(filepath.Join(repoRoot, "docs", "openapi.json"))
	if err != nil {
		t.Fatalf("read openapi.json: %v", err)
	}
	componentsData, err := os.ReadFile(filepath.Join(repoRoot, "docs", "openapi", "components.json"))
	if err != nil {
		t.Fatalf("read components.json: %v", err)
	}

	var root any
	if err := json.Unmarshal(rootData, &root); err != nil {
		t.Fatalf("parse openapi.json: %v", err)
	}

	var components any
	if err := json.Unmarshal(componentsData, &components); err != nil {
		t.Fatalf("parse components.json: %v", err)
	}

	if err := validateOpenAPIRefs(root, root, components); err != nil {
		t.Fatalf("invalid root reference: %v", err)
	}
	if err := validateOpenAPIRefs(components, components, components); err != nil {
		t.Fatalf("invalid component reference: %v", err)
	}
}

func openAPIRepoPaths(t *testing.T) (string, string) {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test source path")
	}

	httpapiDir := filepath.Dir(file)
	repoRoot := filepath.Dir(filepath.Dir(httpapiDir))
	return httpapiDir, repoRoot
}

func openAPISourceRoutes(directory string) (map[openAPIRoute]struct{}, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}

	routes := make(map[openAPIRoute]struct{})
	files := token.NewFileSet()

	for _, entry := range entries {
		if entry.IsDir() ||
			!strings.HasSuffix(entry.Name(), ".go") ||
			strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}

		path := filepath.Join(directory, entry.Name())
		file, err := parser.ParseFile(files, path, nil, 0)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", entry.Name(), err)
		}

		var inspectErr error
		ast.Inspect(file, func(node ast.Node) bool {
			if inspectErr != nil {
				return false
			}

			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}

			literal, ok := call.Args[0].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}

			value, err := strconv.Unquote(literal.Value)
			if err != nil {
				inspectErr = err
				return false
			}

			match := openAPIRoutePattern.FindStringSubmatch(value)
			if match == nil {
				return true
			}

			route := openAPIRoute{
				Method: match[1],
				Path:   match[2],
			}
			if _, exists := routes[route]; exists {
				inspectErr = fmt.Errorf(
					"duplicate source route %s %s",
					route.Method,
					route.Path,
				)
				return false
			}

			routes[route] = struct{}{}
			return true
		})

		if inspectErr != nil {
			return nil, fmt.Errorf("%s: %w", entry.Name(), inspectErr)
		}
	}

	return routes, nil
}

func openAPISpecRoutes(document openAPIContract) (
	map[openAPIRoute]struct{},
	map[openAPIRoute]openAPIOperation,
	error,
) {
	routes := make(map[openAPIRoute]struct{})
	operations := make(map[openAPIRoute]openAPIOperation)

	for path, item := range document.Paths {
		for method, raw := range item {
			method = strings.ToUpper(method)
			if !openAPIHTTPMethod(method) {
				continue
			}

			var operation openAPIOperation
			if err := json.Unmarshal(raw, &operation); err != nil {
				return nil, nil, fmt.Errorf(
					"parse %s %s: %w",
					method,
					path,
					err,
				)
			}

			route := openAPIRoute{
				Method: method,
				Path:   path,
			}
			routes[route] = struct{}{}
			operations[route] = operation
		}
	}

	return routes, operations, nil
}

func compareOpenAPIRoutes(source, spec map[openAPIRoute]struct{}) error {
	var missing []string
	var extra []string

	for route := range source {
		if _, exists := spec[route]; !exists {
			missing = append(missing, route.Method+" "+route.Path)
		}
	}
	for route := range spec {
		if _, exists := source[route]; !exists {
			extra = append(extra, route.Method+" "+route.Path)
		}
	}

	sort.Strings(missing)
	sort.Strings(extra)

	if len(missing) == 0 && len(extra) == 0 {
		return nil
	}

	return fmt.Errorf(
		"OpenAPI route drift:\nmissing from spec: %v\nextra in spec: %v",
		missing,
		extra,
	)
}

func assertOpenAPIPathParameters(
	t *testing.T,
	route openAPIRoute,
	operation openAPIOperation,
	root any,
	components any,
) {
	t.Helper()

	matches := openAPIPathParameter.FindAllStringSubmatch(route.Path, -1)
	if len(matches) == 0 {
		return
	}

	declared := make(map[string]bool)

	for _, raw := range operation.Parameters {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			t.Errorf(
				"%s %s has invalid parameter: %v",
				route.Method,
				route.Path,
				err,
			)
			continue
		}

		parameter, err := dereferenceOpenAPIObject(value, root, components)
		if err != nil {
			t.Errorf(
				"%s %s parameter reference: %v",
				route.Method,
				route.Path,
				err,
			)
			continue
		}

		location, _ := parameter["in"].(string)
		name, _ := parameter["name"].(string)
		if location == "path" {
			declared[name] = true
		}
	}

	for _, match := range matches {
		if !declared[match[1]] {
			t.Errorf(
				"%s %s is missing path parameter %q",
				route.Method,
				route.Path,
				match[1],
			)
		}
	}
}

func dereferenceOpenAPIObject(
	value any,
	root any,
	components any,
) (map[string]any, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected object, got %T", value)
	}

	reference, _ := object["$ref"].(string)
	if reference == "" {
		return object, nil
	}

	resolved, err := resolveOpenAPIRef(reference, root, components)
	if err != nil {
		return nil, err
	}

	object, ok = resolved.(map[string]any)
	if !ok {
		return nil, fmt.Errorf(
			"reference %q resolved to %T, want object",
			reference,
			resolved,
		)
	}
	return object, nil
}

func validateOpenAPIRefs(value, current, components any) error {
	switch value := value.(type) {
	case map[string]any:
		if reference, ok := value["$ref"].(string); ok {
			if _, err := resolveOpenAPIRef(reference, current, components); err != nil {
				return err
			}
		}

		for _, child := range value {
			if err := validateOpenAPIRefs(child, current, components); err != nil {
				return err
			}
		}

	case []any:
		for _, child := range value {
			if err := validateOpenAPIRefs(child, current, components); err != nil {
				return err
			}
		}
	}

	return nil
}

func resolveOpenAPIRef(reference string, current, components any) (any, error) {
	switch {
	case strings.HasPrefix(reference, "#/"):
		return resolveOpenAPIPointer(current, reference)

	case strings.HasPrefix(reference, "./openapi/components.json#"):
		pointer := strings.TrimPrefix(reference, "./openapi/components.json")
		if pointer == "" {
			return components, nil
		}
		return resolveOpenAPIPointer(components, pointer)

	default:
		return nil, fmt.Errorf("unsupported reference %q", reference)
	}
}

func resolveOpenAPIPointer(document any, pointer string) (any, error) {
	if pointer == "#" || pointer == "" {
		return document, nil
	}
	if !strings.HasPrefix(pointer, "#/") {
		return nil, fmt.Errorf("invalid JSON pointer %q", pointer)
	}

	current := document
	for _, rawPart := range strings.Split(strings.TrimPrefix(pointer, "#/"), "/") {
		part := strings.ReplaceAll(rawPart, "~1", "/")
		part = strings.ReplaceAll(part, "~0", "~")

		switch value := current.(type) {
		case map[string]any:
			next, exists := value[part]
			if !exists {
				return nil, fmt.Errorf(
					"JSON pointer %q has no key %q",
					pointer,
					part,
				)
			}
			current = next

		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(value) {
				return nil, fmt.Errorf(
					"JSON pointer %q has invalid index %q",
					pointer,
					part,
				)
			}
			current = value[index]

		default:
			return nil, fmt.Errorf(
				"JSON pointer %q cannot traverse %T",
				pointer,
				current,
			)
		}
	}

	return current, nil
}

func hasSessionCookieSecurity(security []map[string][]string) bool {
	for _, requirement := range security {
		if scopes, exists := requirement["sessionCookie"]; exists && len(scopes) == 0 {
			return true
		}
	}
	return false
}

func isEmptySecurity(raw json.RawMessage) bool {
	var security []map[string][]string
	return json.Unmarshal(raw, &security) == nil && len(security) == 0
}

func openAPIHTTPMethod(method string) bool {
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD":
		return true
	default:
		return false
	}
}

func openAPIPublicRoutes() map[openAPIRoute]struct{} {
	routes := []openAPIRoute{
		{Method: "GET", Path: "/healthz"},
		{Method: "GET", Path: "/readyz"},
		{Method: "GET", Path: "/api/v1/setup/status"},
		{Method: "POST", Path: "/api/v1/setup"},
		{Method: "POST", Path: "/api/v1/auth/login"},
		{Method: "POST", Path: "/api/v1/auth/mfa/verify"},
		{Method: "POST", Path: "/api/v1/auth/logout"},
		{Method: "GET", Path: "/s/{publicId}"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}"},
		{Method: "POST", Path: "/api/v1/public/shares/{publicId}/unlock"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/content"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/download"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/files/{fileId}/content"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/files/{fileId}/download"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/folders/{folderId}"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/folders/{folderId}/download"},
		{Method: "GET", Path: "/api/v1/public/shares/{publicId}/items"},
	}

	result := make(map[openAPIRoute]struct{}, len(routes))
	for _, route := range routes {
		result[route] = struct{}{}
	}
	return result
}
