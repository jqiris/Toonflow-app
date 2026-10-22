import { h } from "vue";
import { ElNotification } from "element-plus";
import nodeError from "./components/nodeError.vue";

/**
 * 正在展示的错误通知标识。
 * ACT: 错误通知是常驻的（duration: 0），element-plus 会把新通知按上一块的高度 + 16px 往下摆，
 * 同一条错误被反复触发（典型是素材缺失后每次保存都重试一次读取）就会堆成一列，
 * 从右上角一路盖住画布上的控件——实测「全屏编辑」按钮的坐标被第 2～3 块通知的标题命中，真实鼠标点不中。
 * 同一份错误同时只留一块通知；用户关掉后标识释放，之后同样的错误仍可再次提示。
 */
const openErrors = new Set<string>();

export function showNodeError(error: unknown, title: string) {
  if (error instanceof Error && error.name === "AbortError") return;
  const detail = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const message = typeof detail === "string" && detail.trim() ? detail
    : error instanceof Error ? error.message : typeof error === "string" ? error : title;
  const key = `${title}\n${message || title}`;
  if (openErrors.has(key)) return;
  const controller = new AbortController();
  openErrors.add(key);
  ElNotification({
    title,
    type: "error",
    duration: 0,
    customClass: "nodeErrorNotification",
    message: h(nodeError, { message: message || title, context: title, signal: controller.signal }),
    onClose: () => {
      openErrors.delete(key);
      controller.abort();
    },
  });
}
