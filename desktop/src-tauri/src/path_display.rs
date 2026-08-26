use std::path::{Path, PathBuf};

pub(crate) fn user_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    return PathBuf::from(user_path_string(path));
    #[cfg(not(windows))]
    return path.to_path_buf();
}

pub(crate) fn user_path_string(path: &Path) -> String {
    normalize_path_string(&path.to_string_lossy())
}

pub(crate) fn same_user_path(left: &str, right: &str) -> bool {
    let left = normalize_path_string(left);
    let right = normalize_path_string(right);
    #[cfg(windows)]
    return left.eq_ignore_ascii_case(&right);
    #[cfg(not(windows))]
    return left == right;
}

fn normalize_path_string(value: &str) -> String {
    #[cfg(windows)]
    {
        const VERBATIM: &str = r"\\?\";
        const VERBATIM_UNC: &str = r"\\?\UNC\";
        if value
            .get(..VERBATIM_UNC.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(VERBATIM_UNC))
        {
            return format!(r"\\{}", &value[VERBATIM_UNC.len()..]);
        }
        if let Some(rest) = value.strip_prefix(VERBATIM) {
            let bytes = rest.as_bytes();
            if bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/')
            {
                return rest.to_owned();
            }
        }
    }
    value.to_owned()
}

#[cfg(test)]
mod tests {
    use super::{same_user_path, user_path_string};
    use std::path::Path;

    #[test]
    fn preserves_normal_paths() {
        #[cfg(windows)]
        assert_eq!(
            user_path_string(Path::new(r"C:\Users\Mew\Sync")),
            r"C:\Users\Mew\Sync"
        );
        #[cfg(not(windows))]
        assert_eq!(
            user_path_string(Path::new("/tmp/discloud")),
            "/tmp/discloud"
        );
    }

    #[cfg(windows)]
    #[test]
    fn removes_windows_verbatim_disk_prefix() {
        assert_eq!(
            user_path_string(Path::new(r"\\?\C:\Users\Mew\Sync")),
            r"C:\Users\Mew\Sync"
        );
    }

    #[cfg(windows)]
    #[test]
    fn converts_windows_verbatim_unc_prefix() {
        assert_eq!(
            user_path_string(Path::new(r"\\?\UNC\server\share\folder")),
            r"\\server\share\folder"
        );
    }

    #[cfg(windows)]
    #[test]
    fn keeps_non_filesystem_verbatim_namespaces() {
        assert_eq!(
            user_path_string(Path::new(r"\\?\Volume{1234}\folder")),
            r"\\?\Volume{1234}\folder"
        );
    }

    #[cfg(windows)]
    #[test]
    fn compares_verbatim_and_display_paths_equally() {
        assert!(same_user_path(
            r"\\?\C:\Users\Mew\Sync",
            r"c:\Users\Mew\Sync"
        ));
    }
}
