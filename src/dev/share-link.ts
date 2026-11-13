// 文字列の共有と画像の共有から、同じ受け取りページへ渡す。
export const MAX_SHARE_LINK_LENGTH = 2000;

export function createReceiveLink(code: string, sample = false): string {
  const url = new URL('./share.html', location.href);
  url.hash = `code=${code}${sample ? '&sample=1' : ''}`;
  return url.href;
}
