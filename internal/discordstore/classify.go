package discordstore

func (e *UpstreamError) StorageClass() string {
	return string(e.Class)
}

func (e *UpstreamError) StorageRetryable() bool {
	return e.Retryable
}
