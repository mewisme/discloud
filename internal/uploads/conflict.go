package uploads

type fileAlreadyExistsError struct{}

func (fileAlreadyExistsError) Error() string {
	return "file already exists"
}

func (fileAlreadyExistsError) Unwrap() error {
	return ErrNameConflict
}

var ErrFileAlreadyExists error = fileAlreadyExistsError{}
