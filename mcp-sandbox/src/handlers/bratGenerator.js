import { Executor } from './executor.js';

export class BratGenerator {
    /**
     * Menghasilkan stiker teks bergaya album Brat (Charli XCX) secara instan
     * @param {Object} options
     * @param {string} options.text - Teks stiker (contoh: "waguri ayu")
     * @param {number} [options.size=800] - Resolusi kanvas persegi
     */
    static async generate({ text = 'brat', size = 800 } = {}) {
        const sanitizedText = (text || 'brat').replace(/"/g, '\\"');
        const canvasSize = Math.max(300, Math.min(Number(size) || 800, 2048));

        const pythonCode = `
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def get_font(font_size):
    font_candidates = [
        "arial.ttf",
        "Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        "C:\\\\Windows\\\\Fonts\\\\arial.ttf"
    ]
    for candidate in font_candidates:
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, font_size)
            except Exception:
                continue
    return ImageFont.load_default()

def generate():
    text = "${sanitizedText}"
    size = (${canvasSize}, ${canvasSize})
    brat_green = (138, 206, 0) # Warna hijau khas #8ACE00
    img = Image.new("RGB", size, brat_green)

    # Perhitungan ukuran font proporsional
    target_width = size[0] * 0.55
    estimated_char_width = target_width / max(len(text), 1)
    base_font_size = int(estimated_char_width * 1.5)
    base_font_size = max(36, min(base_font_size, int(size[1] * 0.35)))

    font = get_font(base_font_size)

    text_canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(text_canvas)

    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    if text_w > size[0] * 0.85:
        scale_down = (size[0] * 0.85) / text_w
        base_font_size = int(base_font_size * scale_down)
        font = get_font(base_font_size)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

    pos_x = (size[0] - text_w) // 2 - bbox[0]
    pos_y = (size[1] - text_h) // 2 - bbox[1]

    # Gambar teks hitam solid
    draw.text((pos_x, pos_y), text, font=font, fill=(0, 0, 0, 255))

    # Efek khas Brat: Sedikit stretch vertikal & soft blur
    stretched_h = int(text_canvas.height * 1.05)
    stretched = text_canvas.resize((text_canvas.width, stretched_h), Image.Resampling.BILINEAR)
    crop_top = (stretched_h - size[1]) // 2
    stretched_cropped = stretched.crop((0, crop_top, size[0], crop_top + size[1]))

    blurred_text = stretched_cropped.filter(ImageFilter.GaussianBlur(radius=1.1))
    img.paste(blurred_text, (0, 0), blurred_text)

    # Low-res compression khas album cover
    small_size = (size[0] // 2, size[1] // 2)
    img_low = img.resize(small_size, resample=Image.Resampling.BILINEAR)
    img_final = img_low.resize(size, resample=Image.Resampling.BICUBIC)

    output_path = "brat_output.png"
    img_final.save(output_path, format="PNG")
    print(f"Stiker brat berhasil dibuat: '{text}'")

generate()
`;

        const result = await Executor.executeScript({
            language: 'python',
            code: pythonCode
        });

        if (result.media) {
            result.media.caption = `Stiker Brat: "${text}"`;
        }

        return result;
    }
}
