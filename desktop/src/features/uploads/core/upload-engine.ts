import { addNativeUploadPaths, cancelNativeUploadTask, removeNativeUploadTask, retryNativeUploadTask } from "./native"

export const uploadEngine = {
  addPaths: addNativeUploadPaths,
  retry: retryNativeUploadTask,
  cancel: cancelNativeUploadTask,
  remove: removeNativeUploadTask,
}
