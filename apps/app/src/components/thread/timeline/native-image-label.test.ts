import { expect, it } from "vitest";
import { buildAttachmentItems } from "./ConversationAttachments";

it("labels native images without exposing transport identifiers", () => {
  const nativeUrl = "/api/v1/threads/thr_1/native-image/content?messageId=message-secret&attachmentId=part-secret";
  const items = buildAttachmentItems({ attachments: {
    webImages: 2, localImages: 0, localFiles: 0,
    imageUrls: [nativeUrl, "https://example.com/photo.png"],
    localImagePaths: [], localFilePaths: [],
  } });
  expect(items.imageItems).toEqual([
    { alt: "Изображение 1 из истории", src: nativeUrl },
    { alt: "photo.png", src: "https://example.com/photo.png" },
  ]);
});
