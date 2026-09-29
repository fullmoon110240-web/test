import { uploadImage } from '../supabase.js';
import { isHttpUrl, isTemporaryDriveUrl, normalizeImageUrl } from '../ui.js';

/*
 * 이미지 고르는 칸. 캐릭터 설정창과 아이템 창이 함께 씁니다.
 *
 *   - 네모 칸을 누르거나 파일을 끌어다 놓으면 → 파일을 고릅니다 (저장할 때 Storage에 올림)
 *   - 아래 칸에 주소를 붙여넣으면 → 그 주소를 그대로 씁니다
 *   - [지우기] → 비웁니다
 *
 * 저장 단추를 누르기 전까지는 아무것도 올리지 않습니다.
 */

// 이보다 크면 줄여서 올립니다. 화면에는 수백 px 로만 나옵니다.
const MAX_SIDE = 1600;
const MAX_BYTES_AS_IS = 1.5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

async function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/*
 * 올리기 전에 너무 큰 그림을 줄입니다.
 * 투명한 배경이 남도록 WEBP(안 되는 브라우저는 PNG)로 바꿉니다.
 * 움직이는 GIF는 줄이면 멈춰 버리므로 그대로 둡니다.
 */
async function prepareImage(file) {
  if (file.type === 'image/gif') return file;

  const mustConvert = !ALLOWED_TYPES.includes(file.type);   // 아이폰 HEIC 등
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (mustConvert) throw new Error('이 형식의 이미지는 열 수 없습니다. PNG나 JPG로 바꿔서 올려 주세요.');
    return file;
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (!mustConvert && scale === 1 && file.size <= MAX_BYTES_AS_IS) {
    bitmap.close?.();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let blob = await canvasToBlob(canvas, 'image/webp', 0.9);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/png');
  if (!blob) return file;

  return mustConvert || blob.size < file.size ? blob : file;
}

export class ImagePicker {
  constructor(root) {
    this.root = root;
    this.preview = root.querySelector('.image-picker-preview');
    this.image = root.querySelector('.image-picker-preview img');
    this.fileInput = root.querySelector('.image-picker-input');
    this.urlInput = root.querySelector('.image-picker-url');
    this.note = root.querySelector('.image-picker-note');
    this.file = null;
    this.objectUrl = '';
    this.original = '';

    this.preview.addEventListener('click', () => this.fileInput.click());
    root.querySelector('.image-picker-file').addEventListener('click', () => this.fileInput.click());
    root.querySelector('.image-picker-clear').addEventListener('click', () => this.clear());

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) this.pickFile(file);
    });

    this.urlInput.addEventListener('input', () => {
      this.dropFile();
      this.showPreview(normalizeImageUrl(this.urlInput.value));
    });

    this.image.addEventListener('error', () => {
      if (this.image.getAttribute('src')) this.setNote('이미지를 불러오지 못했습니다. 주소를 확인해 주세요.', true);
    });
    this.image.addEventListener('load', () => {
      if (!this.file) this.setNote('');
    });

    // 파일을 칸 위로 끌어다 놓아도 됩니다.
    for (const type of ['dragenter', 'dragover']) {
      this.preview.addEventListener(type, event => {
        event.preventDefault();
        this.preview.classList.add('is-dropping');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      this.preview.addEventListener(type, () => this.preview.classList.remove('is-dropping'));
    }
    this.preview.addEventListener('drop', event => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) this.pickFile(file);
    });
  }

  // 창을 열 때 지금 저장된 값으로 되돌립니다.
  reset(url = '') {
    this.dropFile();
    this.original = String(url ?? '');
    this.urlInput.value = this.original;
    this.showPreview(this.original);
    this.setNote('');
  }

  pickFile(file) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
      this.setNote('이미지 파일만 고를 수 있습니다.', true);
      return;
    }
    this.dropFile();
    this.file = file;
    this.objectUrl = URL.createObjectURL(file);
    this.urlInput.value = '';
    this.showPreview(this.objectUrl);
    this.setNote(`고른 파일: ${file.name} · 저장할 때 올라갑니다`);
  }

  clear() {
    this.dropFile();
    this.urlInput.value = '';
    this.showPreview('');
    this.setNote('');
  }

  dropFile() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
    this.file = null;
  }

  showPreview(src) {
    if (src) this.image.src = src;
    else this.image.removeAttribute('src');
    this.preview.classList.toggle('is-empty', !src);
  }

  setNote(message, isError = false) {
    if (!this.note) return;
    this.note.textContent = message;
    this.note.hidden = !message;
    this.note.classList.toggle('is-error', isError);
  }

  isEmpty() {
    return !this.file && !normalizeImageUrl(this.urlInput.value);
  }

  /**
   * 저장 전에 검사합니다. 문제가 있으면 알린 뒤 false.
   * (주소가 이상하거나, 곧 깨지는 임시 주소일 때)
   */
  validate() {
    if (this.file) return true;
    const url = normalizeImageUrl(this.urlInput.value);
    if (!url) return true;
    if (!isHttpUrl(url)) {
      alert('이미지 주소는 http:// 또는 https://로 시작해야 합니다.');
      return false;
    }
    if (isTemporaryDriveUrl(url)) {
      return confirm(
        '드라이브 미리보기에서 복사한 임시 주소로 보입니다.\n시간이 지나면 이미지가 깨집니다.\n\n' +
          '드라이브에서 파일 공유 링크를 복사해 쓰는 편이 좋습니다.\n그래도 이대로 쓸까요?'
      );
    }
    return true;
  }

  /**
   * 최종 주소를 돌려줍니다. 파일을 골랐으면 여기서 올립니다.
   * folder 는 Storage 안의 폴더 이름입니다. (characters / items)
   */
  async resolve(folder) {
    if (this.file) {
      const blob = await prepareImage(this.file);
      const url = await uploadImage(blob, folder);
      this.reset(url);
      return url;
    }
    return normalizeImageUrl(this.urlInput.value);
  }
}
