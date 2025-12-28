use image::DynamicImage;

#[cfg(target_os = "windows")]
use std::io::Cursor;

#[cfg(target_os = "windows")]
use windows::{
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine as WindowsOcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
};

#[cfg(target_os = "windows")]
pub(crate) async fn perform_ocr(image: &DynamicImage) -> Result<(String, Option<f64>), String> {
    use image::GenericImageView;

    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Ok((String::new(), None));
    }

    let mut buffer = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode image: {}", e))?;

    let stream =
        InMemoryRandomAccessStream::new().map_err(|e| format!("Failed to create stream: {}", e))?;

    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|e| format!("Failed to create writer: {}", e))?;

    writer
        .WriteBytes(&buffer)
        .map_err(|e| format!("Failed to write bytes: {}", e))?;

    writer
        .StoreAsync()
        .map_err(|e| format!("StoreAsync failed: {}", e))?
        .await
        .map_err(|e| format!("StoreAsync.await failed: {}", e))?;

    writer
        .FlushAsync()
        .map_err(|e| format!("FlushAsync failed: {}", e))?
        .await
        .map_err(|e| format!("FlushAsync.await failed: {}", e))?;

    stream.Seek(0).map_err(|e| format!("Seek failed: {}", e))?;

    let decoder_id = BitmapDecoder::PngDecoderId()
        .map_err(|e| format!("Failed to get PNG decoder ID: {}", e))?;

    let decoder = BitmapDecoder::CreateWithIdAsync(decoder_id, &stream)
        .map_err(|e| format!("CreateWithIdAsync failed: {}", e))?
        .await
        .map_err(|e| format!("Decoder.await failed: {}", e))?;

    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("GetSoftwareBitmapAsync failed: {}", e))?
        .await
        .map_err(|e| format!("Bitmap.await failed: {}", e))?;

    let engine = WindowsOcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("Failed to create OCR engine: {}", e))?;

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("RecognizeAsync failed: {}", e))?
        .await
        .map_err(|e| format!("OCR result.await failed: {}", e))?;

    let text = result
        .Text()
        .map_err(|e| format!("Failed to get text: {}", e))?
        .to_string();

    Ok((text, Some(1.0)))
}

#[cfg(not(target_os = "windows"))]
pub(crate) async fn perform_ocr(_image: &DynamicImage) -> Result<(String, Option<f64>), String> {
    Err("Windows OCR is only available on Windows".to_string())
}
