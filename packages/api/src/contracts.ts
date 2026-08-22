import type { operations } from "./generated"

export type OperationID = keyof operations
type Get<T, K extends PropertyKey> = K extends keyof T ? T[K] : never
type Parameters<O extends OperationID> = NonNullable<Get<operations[O], "parameters">>
type RequestBody<O extends OperationID> = NonNullable<Get<operations[O], "requestBody">>
type Response<O extends OperationID, S extends PropertyKey> = Get<Get<operations[O], "responses">, S>

export type OperationPath<O extends OperationID> = NonNullable<Get<Parameters<O>, "path">>
export type OperationQuery<O extends OperationID> = NonNullable<Get<Parameters<O>, "query">>
export type OperationHeader<O extends OperationID> = NonNullable<Get<Parameters<O>, "header">>
export type OperationBody<O extends OperationID> = Get<Get<RequestBody<O>, "content">, "application/json">
export type OperationContent<O extends OperationID, S extends PropertyKey, M extends string> = Get<Get<Response<O, S>, "content">, M>
export type OperationJSON<O extends OperationID, S extends PropertyKey> = OperationContent<O, S, "application/json">