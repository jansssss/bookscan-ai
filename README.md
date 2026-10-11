# BookScan AI

한국어 모바일 PWA 북스캐너. React·TypeScript·Vite, OpenCV.js WASM Worker, Tesseract.js 로컬 한영 OCR, IndexedDB, pdf-lib를 사용합니다. 사진·OCR 결과를 서버에 업로드하는 코드나 로그인은 없습니다. 네트워크 요청은 동일 출처의 앱 자산과 공개 언어 모델을 준비할 때만 사용됩니다. 모델은 빌드 시 내려받아 배포 사이트에서 제공합니다.

## 실행

Node 24, pnpm 11.25.0 기준입니다.

```sh
pnpm install --frozen-lockfile
pnpm assets
pnpm dev
pnpm test
pnpm build
pnpm exec vite preview --host 127.0.0.1
```

카메라는 HTTPS 또는 localhost가 필요합니다. PC의 localhost 주소를 휴대폰에서 여는 방식은 지원하지 않습니다. 휴대폰에서는 GitHub Pages HTTPS 주소로 접속하세요. 언어 모델 및 WASM 자산은 `public/vendor/`에 생성되며 소스 저장소에는 포함하지 않습니다. 앱 아이콘만 이미지 파일로 추적합니다. 실제 교재·PDF·OCR 데이터는 Git에 추가하지 마세요.

## 사용

1. 교재 이름과 과목을 입력하고 프로젝트를 만듭니다.
2. 한 페이지 또는 펼친 두 페이지를 선택합니다. 촬영 시작에서 카메라 권한을 허용합니다.
3. 자동 촬영은 카메라 화면에서 켤 수 있습니다. 설정에서 대기 시간과 민감도를 변경합니다. 인식 실패 시 수동 촬영하고 모서리를 직접 이동합니다.
4. 펼친 책은 전체 영역 보정 후 책등의 어두운 열을 추정합니다. 분리 비율을 확인하고 다시 저장합니다. 밝은 책등·그림·복잡한 배경에서는 수동 조정이 필요합니다.
5. 페이지를 선택해 OCR을 실행하고 결과를 수정합니다. 원본 영역과 보정 이미지를 각각 OCR할 수 있습니다. 기존 결과는 새 결과로 교체되므로 비교 전에 복사하거나 TXT로 보관하세요.
6. PDF/TXT/JSON/JPG/ZIP을 명시적으로 다운로드하거나 공유합니다. PDF·ZIP은 한 번에 최대 50페이지이며 원본 크기가 크면 20페이지 이하를 권장합니다.
7. 설정에서 영구 저장을 요청하고 오프라인 준비를 실행합니다. 준비를 마친 뒤 실제 비행기 모드에서 재실행해 확인하세요.

## 구현 범위와 제약

- 영상 프레임 480px 분석: Canny, contour, convex quad, Laplacian variance, 밝기/클리핑, 코너 이동, 안정 시간, 지문 중복 방지·쿨다운. 임계값은 합성 검증 기준의 초기값이며 실촬영 보정이 필요합니다.
- ImageCapture 기능 탐지, 실제 사진의 코너 재검출, 영상 비율 불일치 시 Canvas 촬영 대체. 후면 카메라/전환, 지원하는 torch·zoom·continuous focus만 적용합니다.
- Worker 원근 보정, 그림자 정규화, 보정 컬러/회색/적응형 흑백, 원본 보존, 모서리 수동 조정. 전문 스캐너 수준의 품질을 보증하지 않습니다.
- 실험적 수동 곡면 보정: 사용자가 정한 휘어짐으로 OpenCV remap + cubic interpolation. 텍스트 행 분석·책 곡률 자동 추정·일반적인 3D dewarping은 미구현입니다. 미리보기 후 확인한 경우만 적용합니다.
- Tesseract OSD 기반 자동 회전 버튼과 수동 90° 회전. OSD는 텍스트가 부족하거나 한글 중심인 경우 실패할 수 있으며 신뢰도 미달은 적용하지 않습니다.
- 원본을 먼저 IndexedDB에 임시 보관하고 성공한 페이지를 트랜잭션으로 저장. 미완료 촬영 복구, 재촬영, 순서 변경, 삭제, 책별 설정. 목록은 썸네일·메타데이터만 읽습니다.
- OCR은 Worker에서 수행하며 저신뢰 단어 및 좌표를 제공하고 텍스트 편집을 지원합니다. 저신뢰 영역의 이미지 위 박스 강조와 영역별 편집은 미구현입니다. 작은 글씨·수식·표·명령어를 반드시 원본과 확인하세요.
- 현재 PDF는 이미지 PDF입니다. 좌표와 한글 폰트가 포함된 검색 가능한 PDF는 미구현입니다. 페이지 저장 모드가 PDF 컬러/흑백을 결정합니다.
- ZIP 스키마 `security-pass-ai/bookscan/1`은 문서·페이지 ID, 과목, 번호, 원본/보정 파일 경로, OCR·신뢰도·좌표·스캔 날짜를 연결합니다. 실제 Security Pass AI의 가져오기 API/규격이 제공되지 않았으므로 해당 프로그램에서 읽히는지는 별도 연동 검증이 필요합니다.
- IndexedDB는 기기·브라우저·사이트 주소별로 분리되며 브라우저 정리 시 삭제될 수 있습니다. PC 미리보기의 테스트 자료가 배포 주소로 자동 이동하지 않습니다. 파일 재가져오기/ZIP 복원은 아직 지원하지 않습니다.
- 모바일 Safari의 OffscreenCanvas Worker와 ImageBitmap 지원은 실기기 검증이 필요합니다. 미지원 또는 카메라 권한 거부 시 사진 가져오기를 제공하며 이미지 처리 Worker 미지원 기기에서 처리는 실패할 수 있습니다.

## GitHub Pages

저장소 선택은 사용자 승인을 받은 뒤 진행합니다. 새 공개 저장소 `bookscan-ai`를 권장하며 기존 저장소를 덮어쓰지 않습니다.

1. 소스만 저장소 main 브랜치에 업로드합니다. `public/vendor/`, `dist/`, 실제 스캔 자료는 제외합니다.
2. 저장소 Settings → Pages → Source에서 **GitHub Actions**를 선택합니다.
3. `.github/workflows/pages.yml`이 의존성 설치 → 로컬 OCR 자산 준비 → 테스트 → 타입 검사/빌드 → Pages 배포를 수행합니다.
4. repo 이름을 사용한 `BASE_PATH`와 같은 범위의 Manifest·SW·OCR 자산 경로를 사용합니다. 사용자 루트 사이트나 커스텀 도메인에서는 `BASE_PATH=/`로 바꾸세요.
5. Actions가 성공한 뒤 출력된 HTTPS URL을 스마트폰에서 테스트합니다. 배포 성공 전에는 주소가 작동한다고 보고하지 않습니다.

[Vite 배포 안내](https://vite.dev/guide/static-deploy.html), [OpenCV 원근 변환](https://docs.opencv.org/4.10.0/dd/d52/tutorial_js_geometric_transformations.html), [Tesseract 로컬 경로 안내](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)를 확인했습니다.

## 검증

자동 촬영 판단 단위 테스트는 `pnpm test`로 실행합니다. 앱 주소에 `?diagnostics=1`을 붙이면 실제 Worker·IndexedDB·PDF·ZIP·OCR 모듈을 호출하는 합성 검증을 실행할 수 있습니다. 테스트 데이터는 별도 이름의 프로젝트에 남습니다. 실제 카메라 품질을 입증하는 테스트가 아닙니다. 자세한 결과와 실기기 체크리스트는 `TEST_REPORT.md`를 확인하세요.
