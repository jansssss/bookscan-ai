type AndroidBridge = {
  scanDocuments(limit: number): void;
  saveFile(base64: string, name: string, mime: string, share: boolean): void;
  releaseScan(filename: string): void;
};
declare global {
  interface Window {
    BookScanNative?: AndroidBridge;
  }
}
export const native = () => window.BookScanNative;
function response<T>(name: string, start: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = (event: Event) => {
      window.removeEventListener(name, done);
      const detail = (event as CustomEvent).detail;
      detail.error ? reject(Error(detail.error)) : resolve(detail);
    };
    window.addEventListener(name, done);
    try {
      start();
    } catch (e) {
      window.removeEventListener(name, done);
      reject(e);
    }
  });
}
export async function nativeScan(limit = 50) {
  return (
    (
      await response<{ urls?: string[] }>("bookscan-native-scan", () =>
        native()!.scanDocuments(limit),
      )
    ).urls || []
  );
}
export async function nativeSave(blob: Blob, name: string, share: boolean) {
  if (blob.size > 40 * 1024 * 1024)
    throw Error(
      "APK에서 한 번에 저장할 파일은 40MB 이하로 만들어주세요. 내보내기 범위를 줄일 수 있습니다.",
    );
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(blob);
  });
  await response("bookscan-native-file", () =>
    native()!.saveFile(
      base64,
      name,
      blob.type || "application/octet-stream",
      share,
    ),
  );
}
