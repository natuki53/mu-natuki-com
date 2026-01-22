import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const GALLERY_DIR = './public/gallery';
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1920; // 縦長画像も考慮して1920x1920を最大とする

async function resizeImage(filePath) {
  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    // 既に1080p以下の場合はスキップ
    if (metadata.width <= MAX_WIDTH && metadata.height <= MAX_HEIGHT) {
      console.log(`✓ ${filePath} は既に1080p以下です (${metadata.width}x${metadata.height})`);
      return;
    }

    // 元のファイルをバックアップ（.bak拡張子で保存）
    const backupPath = filePath + '.bak';
    if (!existsSync(backupPath)) {
      const originalBuffer = await sharp(filePath).toBuffer();
      await sharp(originalBuffer).toFile(backupPath);
      console.log(`📦 バックアップ作成: ${backupPath}`);
    }

    // 一時ファイルにリサイズ
    const tempPath = filePath + '.tmp';
    await image
      .resize(MAX_WIDTH, MAX_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .toFile(tempPath);

    // 一時ファイルを元のファイル名にリネーム
    const { rename } = await import('fs/promises');
    await rename(tempPath, filePath);
    
    const newMetadata = await sharp(filePath).metadata();
    console.log(`✓ ${filePath} をリサイズしました: ${metadata.width}x${metadata.height} → ${newMetadata.width}x${newMetadata.height}`);
  } catch (error) {
    console.error(`✗ ${filePath} の処理中にエラー:`, error.message);
  }
}

async function main() {
  try {
    const files = await readdir(GALLERY_DIR);
    const imageFiles = files.filter(file => 
      file.toLowerCase().endsWith('.png') || 
      file.toLowerCase().endsWith('.jpg') || 
      file.toLowerCase().endsWith('.jpeg')
    );

    console.log(`📸 ${imageFiles.length}個の画像ファイルを処理します...\n`);

    for (const file of imageFiles) {
      const filePath = join(GALLERY_DIR, file);
      await resizeImage(filePath);
    }

    console.log('\n✨ すべての画像の処理が完了しました！');
  } catch (error) {
    console.error('エラー:', error);
    process.exit(1);
  }
}

main();
