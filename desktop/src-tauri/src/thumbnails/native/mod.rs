use std::path::Path;

#[cfg(target_os = "windows")]
mod platform {
    use std::{mem::size_of, os::windows::ffi::OsStrExt, path::Path};

    use image::{ImageFormat, RgbaImage};
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::SIZE,
            Graphics::Gdi::{
                CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP,
                BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
            },
            System::Com::{CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED},
            UI::Shell::{
                IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_RESIZETOFIT,
                SIIGBF_THUMBNAILONLY,
            },
        },
    };

    pub(super) fn generate(path: &Path, output: &Path, size: u32) -> Result<(), String> {
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if initialized.is_err() {
            return Err(format!("initialize COM: {}", initialized.message()));
        }
        let result = generate_inner(path, output, size);
        unsafe { CoUninitialize() };
        result
    }

    fn generate_inner(path: &Path, output: &Path, size: u32) -> Result<(), String> {
        let wide = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let factory: IShellItemImageFactory =
            unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None::<&IBindCtx>) }
                .map_err(|error| format!("create shell item: {error}"))?;
        let bitmap = unsafe {
            factory.GetImage(
                SIZE {
                    cx: size as i32,
                    cy: size as i32,
                },
                SIIGBF_THUMBNAILONLY | SIIGBF_RESIZETOFIT,
            )
        }
        .map_err(|error| format!("get shell thumbnail: {error}"))?;

        let result = bitmap_to_png(bitmap, output);
        unsafe {
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
        }
        result
    }

    fn bitmap_to_png(
        bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
        output: &Path,
    ) -> Result<(), String> {
        let mut description = BITMAP::default();
        let described = unsafe {
            GetObjectW(
                HGDIOBJ(bitmap.0),
                size_of::<BITMAP>() as i32,
                Some((&mut description as *mut BITMAP).cast()),
            )
        };
        if described == 0 || description.bmWidth <= 0 || description.bmHeight == 0 {
            return Err("read shell thumbnail dimensions".to_string());
        }

        let width = description.bmWidth as u32;
        let height = description.bmHeight.unsigned_abs();
        let byte_len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|value| value.checked_mul(4))
            .ok_or_else(|| "shell thumbnail dimensions overflowed".to_string())?;
        let mut pixels = vec![0u8; byte_len];
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };

        let dc = unsafe { CreateCompatibleDC(None) };
        if dc.0.is_null() {
            return Err("create shell thumbnail device context".to_string());
        }
        let rows = unsafe {
            GetDIBits(
                dc,
                bitmap,
                0,
                height,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            )
        };
        unsafe {
            let _ = DeleteDC(dc);
        }
        if rows != height as i32 {
            return Err("read shell thumbnail pixels".to_string());
        }

        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        if pixels.chunks_exact(4).all(|pixel| pixel[3] == 0) {
            for pixel in pixels.chunks_exact_mut(4) {
                pixel[3] = 255;
            }
        }

        let image = RgbaImage::from_raw(width, height, pixels)
            .ok_or_else(|| "construct shell thumbnail image".to_string())?;
        image
            .save_with_format(output, ImageFormat::Png)
            .map_err(|error| format!("save shell thumbnail: {error}"))
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{path::Path, sync::mpsc, time::Duration};

    use block2::RcBlock;
    use objc2::AnyThread;
    use objc2_core_foundation::CGSize;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_quick_look_thumbnailing::{
        QLThumbnailGenerationRequest, QLThumbnailGenerationRequestRepresentationTypes,
        QLThumbnailGenerator,
    };

    pub(super) fn generate(path: &Path, output: &Path, size: u32) -> Result<(), String> {
        let input_path = NSString::from_str(&path.to_string_lossy());
        let output_path = NSString::from_str(&output.to_string_lossy());
        let input_url = NSURL::fileURLWithPath(&input_path);
        let output_url = NSURL::fileURLWithPath(&output_path);
        let request = unsafe {
            QLThumbnailGenerationRequest::initWithFileAtURL_size_scale_representationTypes(
                QLThumbnailGenerationRequest::alloc(),
                &input_url,
                CGSize {
                    width: size as f64,
                    height: size as f64,
                },
                1.0,
                QLThumbnailGenerationRequestRepresentationTypes::Thumbnail,
            )
        };
        let generator = unsafe { QLThumbnailGenerator::sharedGenerator() };
        let content_type = NSString::from_str("public.png");
        let (sender, receiver) = mpsc::sync_channel(1);
        let completion = RcBlock::new(move |error: *mut NSError| {
            let _ = sender.send(error.is_null());
        });

        #[allow(deprecated)]
        unsafe {
            generator
                .saveBestRepresentationForRequest_toFileAtURL_withContentType_completionHandler(
                    &request,
                    &output_url,
                    &content_type,
                    &completion,
                );
        }

        match receiver.recv_timeout(Duration::from_secs(15)) {
            Ok(true) => Ok(()),
            Ok(false) => Err("Quick Look thumbnail generation failed".to_string()),
            Err(_) => {
                unsafe { generator.cancelRequest(&request) };
                Err("Quick Look thumbnail generation timed out".to_string())
            }
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use std::path::Path;

    pub(super) fn generate(_path: &Path, _output: &Path, _size: u32) -> Result<(), String> {
        Err("native thumbnail provider is unavailable".to_string())
    }
}

pub(super) fn generate(path: &Path, output: &Path, size: u32) -> Result<(), String> {
    platform::generate(path, output, size)
}
