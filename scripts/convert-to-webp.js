import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const GALLERY_DIR = './public/gallery';

async function convertToWebP(filePath) {
  try {
    // PNGファイルのみ処理
    if (!filePath.toLowerCase().endsWith('.png')) {
      return;
    }

    // 既にWebPが存在する場合はスキップ
    const webpPath = filePath.replace(/\.png$/i, '.webp');
    if (existsSync(webpPath)) {
      console.log(`✓ ${webpPath} は既に存在します`);
      return;
    }

    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    // WebPに変換（品質85%でバランスの良い圧縮）
    await image
      .webp({ quality: 85, effort: 6 })
      .toFile(webpPath);

    // ファイルサイズを比較
    const { statSync } = await import('fs');
    const originalSize = statSync(filePath).size;
    const webpSize = statSync(webpPath).size;
    const reduction = ((1 - webpSize / originalSize) * 100).toFixed(1);

    console.log(`✓ ${filePath} → ${webpPath}`);
    console.log(`  ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(webpSize / 1024 / 1024).toFixed(2)}MB (${reduction}%削減)`);
  } catch (error) {
    console.error(`✗ ${filePath} の処理中にエラー:`, error.message);
  }
}

async function main() {
  try {
    const files = await readdir(GALLERY_DIR);
    const imageFiles = files.filter(file => 
      file.toLowerCase().endsWith('.png')
    );

    console.log(`📸 ${imageFiles.length}個のPNGファイルをWebPに変換します...\n`);

    for (const file of imageFiles) {
      const filePath = join(GALLERY_DIR, file);
      await convertToWebP(filePath);
    }

    console.log('\n✨ すべての画像の変換が完了しました！');
  } catch (error) {
    console.error('エラー:', error);
    process.exit(1);
  }
}

main();
