<template>
  <el-dialog
    v-model="visible"
    class="scoreDialog"
    title="引擎配乐"
    width="560px"
    appendToBody
    :closeOnClickModal="false"
  >
    <div class="scoreBody">
      <label class="scoreField">
        <span class="scoreLabel">引擎编辑工程号（专用配乐工程）</span>
        <el-input v-model="editorProjectId" size="small" :maxlength="34" placeholder="e- 加 32 位十六进制，FreeVideo 编辑器里的工程号" />
      </label>
      <label class="scoreField">
        <span class="scoreLabel">配乐描述（英文，≤512 字符）</span>
        <el-input v-model="caption" type="textarea" :rows="3" :maxlength="512" placeholder="Epic orchestral, dramatic, with piano and strings" />
      </label>
      <p class="scoreHint">{{ hintText }}</p>
      <el-alert v-if="errorMessage" class="scoreError" :title="errorMessage" type="error" :closable="false" showIcon />
      <p v-if="submitted" class="scoreSuccess">{{ successText }}</p>
      <div class="scoreActions">
        <el-button size="small" type="primary" :loading="loading" :disabled="!canSubmit" @click="submit">{{ loading ? "作曲中" : "生成配乐" }}</el-button>
        <span v-if="loading" class="scoreStatus">引擎正在作曲（首次使用要下载约 20GB 音乐模型，可能耗时几十分钟）；关掉窗口不会取消任务</span>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElAlert, ElButton, ElDialog, ElInput, ElMessage } from "element-plus";

const props = defineProps<{
  /** 工作区目录：配乐产物落到该目录的 assets/generated 下。 */
  directory?: string;
  /** 配乐是供应商级能力：providerId/modelId 取工程的全局视频模型（modelId 只用于确认供应商已配置）。 */
  providerId?: string;
  modelId?: string;
}>();

const visible = defineModel<boolean>({ default: false });

type ScoreResult = { path: string; jobId: string; frames: number; seed: number };

const editorProjectId = ref("");
const caption = ref("");
const loading = ref(false);
const errorMessage = ref("");
const submitted = ref(false);
const successText = ref("");

const projectIdValid = computed(() => /^e-[0-9a-f]{32}$/.test(editorProjectId.value.trim().toLowerCase()));
const canSubmit = computed(() =>
  Boolean(props.directory && props.providerId && props.modelId && projectIdValid.value && caption.value.trim()));

/** 引擎约定逐条给到界面上：F4 专用工程、长度=时间线、失败不阻断成片。 */
const hintText = computed(() => {
  if (!props.providerId || !props.modelId) return "工程还没有视频模型，先在快捷设置里选择（配乐走该模型所属引擎）";
  if (editorProjectId.value.trim() && !projectIdValid.value) return "工程号格式：e- 加 32 位十六进制（在 FreeVideo 编辑器里复制工程地址可得）";
  return "配乐长度=该工程时间线长度（须在 10–600 秒）；请用专用配乐工程：引擎会先移除该工程 a2 轨的旧配乐再铺新的（F4）。配乐失败不影响合成成片。";
});

async function submit() {
  if (!canSubmit.value || loading.value) return;
  loading.value = true;
  errorMessage.value = "";
  submitted.value = false;
  try {
    const response = await fetch("/api/ai/media/music", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({
        directory: props.directory,
        providerId: props.providerId,
        modelId: props.modelId,
        editorProjectId: editorProjectId.value.trim().toLowerCase(),
        // ACT: revision 只是服务端 schema 的必填位：供应商 music() 先 GET /projects 读最新 revision
        // 再作曲（过期值被引擎侧覆盖），界面上拿不到引擎工程的版本号，传 1 占位即可。
        revision: 1,
        caption: caption.value.trim(),
        // F4：不传 sourceVideo——成片导入分支会 remove v1 轨并新建素材，配乐只走纯作曲分支。
      }),
    });
    const payload = await response.json().catch(() => undefined) as { data?: ScoreResult; message?: string } | undefined;
    if (!response.ok || !payload?.data) {
      // 服务端把 zod 明细放在 data、message 恒为「参数错误」；只读 message 会看不到具体哪个字段错。
      const detail = payload?.data ? `：${JSON.stringify(payload.data).slice(0, 300)}` : "";
      throw new Error(`${payload?.message || `配乐请求失败（HTTP ${response.status}）`}${detail}`);
    }
    const result = payload.data;
    successText.value = `已生成配乐：${result.path}（${result.frames} 帧 · 长度=时间线 · seed ${result.seed} · 任务 ${result.jobId}），已铺到该工程 a2 轨第 0 帧`;
    submitted.value = true;
    ElMessage.success("配乐已生成");
  } catch (reason) {
    // 引擎错误已由服务端译成中文，原样展示。
    errorMessage.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    loading.value = false;
  }
}

watch(visible, shown => {
  if (shown) errorMessage.value = "";
});
</script>

<style scoped>
.scoreBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.scoreField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scoreLabel {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.scoreHint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.scoreError {
  width: 100%;
}

.scoreSuccess {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--el-color-success);
  font-size: 13px;
  line-height: 1.6;
}

.scoreActions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scoreStatus {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
