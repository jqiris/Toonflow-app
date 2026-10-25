import { onScopeDispose, ref } from "vue";
import axios from "axios";
import { useWorkspaceStore } from "@/stores/workspace";

type SessionItem = { file: string; modified: string };

/**
 * 后台运行状态：以服务端会话的真实 `running` 为准。
 * 取数链路：`GET /api/agent/list` 拿会话清单 → `GET /api/agent/get` 的 `running` 字段
 * （服务端由 `getActiveAgentSession(path)` 计算，见 apps/server/src/agent/runtime/sessions.ts:403）。
 * 本地流式状态（conversation.vue 的 busy/remoteRunning）只作补充——刷新后本地状态会丢，服务端 running 不会。
 *
 * ACT: `/api/agent/list` 不返回 running（sessions.ts:247-260 只给 file/name/modified/messageCount），
 * 也没有「整个工程有没有在跑」的接口，所以这里先取列表，再只对「可能刚变过」的会话逐个读 get：
 * 轮询间隔内 modified 变过的、以及可能正在跑的那个。上限 6 个/轮，避免每轮把全部会话都解析一遍；
 * 会话多的工程想更省，应由后端给 list 加 running 字段（本轮不改后端）。
 */
export default function useAgentRunStatus(options: { interval?: number } = {}) {
  const workspaceStore = useWorkspaceStore();
  const runningFile = ref<string>();
  // 每个会话上次见到的时间戳：轮询只能看见「变化」，靠它把新出现/刚写过的会话挑出来。
  const seenModified = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;

  async function readRunning(directory: string, file: string) {
    const { data } = await axios.get<{ code: number; data?: { running?: boolean } }>("/api/agent/get", {
      params: { directory, sessionFile: file },
      headers: { "x-toonflow-workspace": "1" },
    });
    return data.code === 200 && data.data?.running === true;
  }

  async function poll() {
    const directory = workspaceStore.project?.directory;
    // 页面切到后台就不用轮询：用户看不见，回来时立即补一轮（visibilitychange 里也调了 poll）。
    if (!directory || polling || document.hidden) return;
    polling = true;
    try {
      const { data } = await axios.get<{ code: number; data?: SessionItem[] }>("/api/agent/list", {
        params: { directory },
        headers: { "x-toonflow-workspace": "1" },
      });
      const sessions = data.code === 200 ? (data.data ?? []) : [];
      // 候选 = 上一轮在跑的 + 本轮 modified 变过的 + 最近一条会话。
      // 最后一条兜底：轮次刚开始、还没往 jsonl 里写东西时 modified 不会变，只靠变化会漏掉它。
      const candidates = [
        ...new Set([
          ...sessions
            .filter(item => item.file === runningFile.value || seenModified.get(item.file) !== item.modified)
            .map(item => item.file),
          ...(sessions[0] ? [sessions[0].file] : []),
        ]),
      ].slice(0, 6);
      let running: string | undefined;
      for (const file of candidates) {
        const item = sessions.find(entry => entry.file === file);
        if (!item) continue;
        seenModified.set(file, item.modified);
        if (await readRunning(directory, file)) {
          running = file;
          break;
        }
      }
      runningFile.value = running;
      // 会话被删/换工程后清掉备忘，避免 Map 无限长。
      const alive = new Set(sessions.map(item => item.file));
      for (const file of seenModified.keys()) if (!alive.has(file)) seenModified.delete(file);
    } catch {
      // 轮询失败保持上一轮结论，不把界面打回「未知」，等下一轮自愈。
    } finally {
      polling = false;
    }
  }

  function start() {
    if (timer) return;
    void poll();
    timer = setInterval(() => void poll(), options.interval ?? 5000);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  function onVisibilityChange() {
    if (!document.hidden) void poll();
  }

  onScopeDispose(stop);

  return { runningFile, poll, start, stop };
}
