# Android APK

Galaxy S23 / Android 16을 대상으로 만든 테스트용 앱입니다. ML Kit 문서 스캐너는 Google Play 서비스가 제공하는 네이티브 화면으로 자동 촬영, 영역 보정, 여러 페이지 촬영을 처리합니다. 기존 React 화면은 APK 안에 포함되므로 홈페이지 접속 없이 교재 관리·로컬 OCR·내보내기를 사용합니다.

## 빌드

GitHub Actions의 **Android APK** 작업은 Node 24 / Java 17 / Gradle 8.13 / Android SDK 35로 `assembleDebug lintDebug`를 실행합니다. 성공한 작업의 `BookScan-AI-APK` 아티팩트에는 설치 가능한 `BookScan-AI.apk`와 SHA-256 파일이 있습니다. PC에서 ZIP을 해제한 뒤 APK를 휴대폰으로 전달합니다.

로컬에서는 `pnpm install`, `pnpm assets`, `pnpm build` 후 `dist` 내용을 `android/app/src/main/assets/web`에 복사하고 Java 17·SDK 35 환경에서 `gradle -p android assembleDebug`를 실행합니다.

## 설치

APK를 연 파일 관리자 또는 브라우저에 대해서만 '알 수 없는 앱 설치'를 허용합니다. 설치 후 허용을 다시 끌 수 있습니다. Play Protect가 알려지지 않은 앱 검사를 요청하면 검사를 진행합니다. 유해 앱 차단이나 삼성 자동 차단 경고가 나오면 정확한 문구를 확인하고 원인을 해결합니다. 앱에서 보안 설정을 바꾸거나 우회하지 않습니다.

테스트 APK는 debug 서명입니다. CI 캐시에 키를 유지하지만 캐시가 사라지면 서명이 바뀔 수 있습니다. 업데이트 설치가 서명 불일치로 실패하면 기존 앱을 삭제하기 전에 PDF·ZIP을 내보내야 합니다. 장기 배포용 서명키와 Play Store 배포는 별도 준비가 필요합니다.

## 기능과 범위

- 촬영 버튼 → Google 스캐너 → 최대 50페이지 촬영·확인 → 교재에 순차 저장.
- 재촬영은 1페이지 스캔 결과로 교체합니다.
- 한국어 OCR 모델·OpenCV 파일은 APK에 포함됩니다. ML Kit 구성요소는 Google Play 서비스가 첫 실행 때 다운로드할 수 있습니다.
- Google 스캐너가 반환하는 보정 JPEG를 저장합니다. 촬영 전 원본은 API가 제공하지 않습니다. ZIP의 originals도 반환된 JPEG입니다.
- 펼친 책의 좌우 자동 분리와 완전한 곡면 펴기는 이 네이티브 촬영 경로에서 제공하지 않습니다. 한 페이지씩 촬영합니다.
- PDF·TXT·JSON·ZIP 저장은 Android 파일 선택기를 사용하며, 공유는 Android 공유 창을 사용합니다. 네이티브 전달 메모리를 제한하기 위해 파일당 40MB까지 지원합니다.
- 앱 내부 WebView는 앱 자산과 스캔 결과만 로드합니다. 외부 페이지에 네이티브 브리지를 노출하지 않습니다. 카메라·사진 전체 접근 권한은 요청하지 않습니다.
- 웹앱과 APK의 저장공간은 별개입니다. 기존 웹앱 문서의 자동 이관은 아직 지원하지 않습니다.
- 실제 S23 설치·촬영·내보내기 검증은 APK를 전달한 뒤 필요합니다.

공식 문서: [Google 문서 스캐너](https://developers.google.com/ml-kit/vision/doc-scanner/android), [WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader).
