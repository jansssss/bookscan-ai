# 오픈소스 의존성

2026-10-11 설치한 잠금 파일 기준입니다. 최신 릴리스라고 주장하지 않으며 검증 대상으로 선택한 버전입니다. 설치 시 OpenCV 5 / Tesseract 7 / Vite 8 등 새 주요 버전도 확인했으나 이번 구현은 기존 API 호환 버전을 사용합니다.

| 패키지 | 설치 버전 | 라이선스 |
| --- | --- | --- |
| React / react-dom | 19.3.0 | MIT |
| Vite | 7.3.7 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| @techstark/opencv-js | 4.11.0-release.1 | Apache-2.0 |
| tesseract.js | 6.0.1 | Apache-2.0 |
| pdf-lib | 1.17.1 | MIT |
| fflate | 0.8.3 | MIT |
| idb | 8.0.4 | ISC |

라이선스는 설치된 package.json과 제공된 LICENSE 파일을 확인했습니다. OpenCV 4.5 이상은 [Apache 2.0](https://opencv.org/license/)입니다. Tesseract 및 언어 데이터는 [Tesseract 프로젝트](https://github.com/tesseract-ocr/tessdata)의 라이선스에 따릅니다. 빌드 자산 준비 시 제공되는 라이선스 파일을 `vendor/licenses/`로 복사합니다. 유료 OCR API·스캔 SDK·ML Kit 네이티브 API는 사용하지 않습니다.

브라우저 기능은 지원 여부를 실행 시 검사합니다. ImageCapture·torch·zoom은 선택 기능입니다. Worker OffscreenCanvas·WASM·createImageBitmap·IndexedDB는 이미지 처리의 필수 런타임이며 Android Chrome을 우선 대상으로 합니다. Safari에서 실제 이미지 처리와 파일 공유를 별도 확인해야 합니다.
