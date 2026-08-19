import type { OperationBody, OperationHeader, OperationJSON, OperationPath, OperationQuery } from "@/lib/api/contracts"

export type SetupStatus = OperationJSON<"getSetupStatus", 200>
export type SetupInput = OperationBody<"completeSetup">
export type SetupResult = OperationJSON<"completeSetup", 201>

export type User = OperationJSON<"getAuthenticatedUser", 200>
export type UserRole = User["role"]
export type LoginInput = OperationBody<"login">
export type LoginResult = OperationJSON<"login", 200>
export type MFAChallenge = Extract<LoginResult, { mfaRequired: true }>
export type VerifyLoginMFAInput = OperationBody<"verifyLoginMFA">
export type UpdateMeInput = OperationBody<"updateMe">
export type ChangePasswordInput = OperationBody<"changePassword">
export type Sessions = OperationJSON<"listSessions", 200>
export type Session = Sessions["sessions"][number]
export type MFAStatus = OperationJSON<"getMFAStatus", 200>
export type MFAEnrollment = OperationJSON<"beginMFAEnrollment", 201>
export type MFACodeInput = OperationBody<"confirmMFAEnrollment">
export type RecoveryCodes = OperationJSON<"confirmMFAEnrollment", 200>

export type AdminUser = OperationJSON<"getUser", 200>
export type AdminUsers = OperationJSON<"listUsers", 200>
export type ListUsersQuery = OperationQuery<"listUsers">
export type CreateUserInput = OperationBody<"createUser">
export type UpdateUserInput = OperationBody<"updateUser">
export type SetUserQuotaInput = OperationBody<"setUserQuota">
export type ResetUserPasswordInput = OperationBody<"resetUserPassword">
export type UserUsage = OperationJSON<"getUserUsage", 200>
export type RootFolder = OperationJSON<"getUserRoot", 200>
export type AuditQuery = OperationQuery<"listAuditEvents">
export type AuditPage = OperationJSON<"listAuditEvents", 200>
export type AuditEvent = AuditPage["events"][number]
export type JobsQuery = OperationQuery<"listJobs">
export type JobPage = OperationJSON<"listJobs", 200>
export type JobDiagnostic = JobPage["jobs"][number]
export type UploadDiagnosticsQuery = OperationQuery<"listUploadDiagnostics">
export type UploadDiagnosticPage = OperationJSON<"listUploadDiagnostics", 200>
export type UploadDiagnostic = UploadDiagnosticPage["uploads"][number]
export type StorageOverview = OperationJSON<"getStorageOverview", 200>
export type ReconcileQuotaInput = OperationBody<"reconcileQuota">
export type QuotaReconciliationPage = OperationJSON<"reconcileQuota", 200>

export type Node = OperationJSON<"getFolder", 200>
export type NodeKind = Node["kind"]
export type NodePage = OperationJSON<"listFolderChildren", 200>
export type FolderChildrenQuery = OperationQuery<"listFolderChildren">
export type Breadcrumbs = OperationJSON<"getFolderBreadcrumbs", 200>
export type CreateFolderInput = OperationBody<"createFolder">
export type UpdateFolderInput = OperationBody<"updateFolder">
export type BatchFoldersInput = OperationBody<"createFolderBatch">
export type BatchFoldersResult = OperationJSON<"createFolderBatch", 200>
export type RestoreNodeInput = OperationBody<"restoreFolder">
export type FolderPermissions = OperationJSON<"listFolderPermissions", 200>
export type AccessGrant = FolderPermissions["permissions"][number]
export type AccessLevel = AccessGrant["level"]
export type AccessLevelInput = OperationBody<"setFolderPermission">

export type File = OperationJSON<"getFile", 200>
export type FileCategory = File["category"]
export type MetadataStatus = File["metadataStatus"]
export type FileContentQuery = OperationQuery<"streamFile">

export type CreateUploadInput = OperationBody<"createUpload">
export type UploadSession = OperationJSON<"createUpload", 201>
export type UploadStatus = UploadSession["status"]
export type UploadPart = OperationJSON<"putUploadPart", 200>
export type UploadPartPath = OperationPath<"putUploadPart">
export type UploadPartHeaders = OperationHeader<"putUploadPart">
export type CompletedFile = OperationJSON<"completeUpload", 200>

export type TrashQuery = OperationQuery<"listTrash">
export type TrashPage = OperationJSON<"listTrash", 200>
export type TrashItem = TrashPage["items"][number]

export type Collection = OperationJSON<"getCollection", 200>
export type CollectionPage = OperationJSON<"listCollections", 200>
export type CollectionsQuery = OperationQuery<"listCollections">
export type CreateCollectionInput = OperationBody<"createCollection">
export type UpdateCollectionInput = OperationBody<"updateCollection">
export type RestoreCollectionInput = OperationBody<"restoreCollection">
export type CollectionItems = OperationJSON<"listCollectionItems", 200>
export type CollectionItem = CollectionItems["items"][number]
export type AddCollectionItemInput = OperationBody<"addCollectionItem">
export type CollectionAccess = OperationJSON<"listCollectionAccess", 200>
export type CollectionAccessGrant = CollectionAccess["access"][number]

export type CreateShareInput = OperationBody<"createShare">
export type Share = OperationJSON<"createShare", 201>
export type ShareResourceType = Share["resourceType"]
export type PublicShare = OperationJSON<"resolvePublicShare", 200>
export type PublicFolder = OperationJSON<"getPublicFolder", 200>
export type PublicItems = OperationJSON<"listPublicCollectionItems", 200>
export type PublicNode = PublicItems["items"][number]

export type SearchQuery = OperationQuery<"search">
export type SearchPage = OperationJSON<"search", 200>
export type SearchResult = SearchPage["results"][number]