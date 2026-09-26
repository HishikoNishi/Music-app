# Music Tray Player

Ứng dụng Electron nghe nhạc chạy nền qua system tray trên Windows — hỗ trợ nhạc cục bộ và **YouTube Music**.

## Chạy khi phát triển

```powershell
npm install

# Cấu hình YouTube API Key (bắt buộc để dùng tab YouTube)
copy config.example.js config.js
# Mở config.js và thay YOUR_API_KEY_HERE bằng API Key thật

npm start
```

Đóng cửa sổ bằng nút **X** chỉ ẩn app xuống tray; dùng menu tray **Thoát** để tắt hẳn. Nhạc cục bộ và danh sách phát được lưu bằng `electron-store`.

## Cấu hình YouTube API

1. Vào [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Tạo project (hoặc chọn project có sẵn)
3. Bật **YouTube Data API v3** trong thư viện API
4. Tạo **API Key** (Credentials → Create credentials → API key)
5. Copy `config.example.js` → `config.js` và dán key vào `YOUTUBE_API_KEY`

> **Lưu ý:** File `config.js` nằm trong `.gitignore` — không commit API Key lên git.

## YouTube Music

1. Mở tab **YouTube** trên sidebar
2. Gõ tên bài hát → **Tìm kiếm**
3. Click một kết quả → phát ngay qua YouTube IFrame Player
4. Dùng thanh phát nhạc phía dưới: Play/Pause, Next/Previous, Volume, Seek

Tìm kiếm gọi **YouTube Data API v3** (`type=video`, `videoCategoryId=10`) từ main process — API Key không lộ ra renderer.

## Nhạc cục bộ

- Thêm nhạc qua **Chọn nhạc** (MP3, M4A, FLAC, WAV, OGG)
- Kéo thả tệp từ File Explorer
- Phân loại theo tâm trạng, thể loại, ca sĩ

## Đóng gói Windows

```powershell
npm run build
```

File cài đặt NSIS được tạo trong `dist/Music Tray Player Setup 1.0.0.exe`.

## Điều khiển

- Tray menu và phím `MediaPlayPause`, `MediaNextTrack`, `MediaPreviousTrack` điều khiển trình phát khi cửa sổ ẩn.
