<template>
  <section class="engineProfilePanel" aria-label="引擎能力档案">
    <header class="panelHeader">
      <span class="panelTitle">引擎能力档案</span>
      <span class="panelMeta">{{ providerId || "未选择供应商" }}</span>
    </header>

    <el-skeleton v-if="loading" :rows="4" animated />
    <el-alert v-else-if="errorMessage" title="档案不可用" :description="errorMessage" type="error" :closable="false" />
    <p v-else-if="!providerId" class="panelHint">未选择供应商，暂无引擎档案。</p>
    <p v-else-if="unsupported" class="panelHint">当前供应商不提供引擎能力档案。</p>
    <template v-else>
      <section class="profileSection">
        <h4 class="sectionTitle">硬上限</h4>
        <dl class="limitList">
          <div v-for="row in limitRows" :key="row.key" class="limitRow">
            <dt class="limitLabel">{{ row.label }}</dt>
            <dd class="limitValue">{{ row.text }}</dd>
          </div>
        </dl>
      </section>

      <section class="profileSection">
        <h4 class="sectionTitle">质量档位</h4>
        <dl v-if="qualityRows.length" class="limitList">
          <div v-for="row in qualityRows" :key="row.key" class="limitRow">
            <dt class="limitLabel">{{ row.key }}</dt>
            <dd class="limitValue">{{ row.text }}</dd>
          </div>
        </dl>
        <p v-else class="panelHint">引擎未上报质量档位。</p>
      </section>

      <section class="profileSection">
        <h4 class="sectionTitle">已装 LoRA（{{ loras.length }}）</h4>
        <ul v-if="loras.length" class="loraList">
          <li v-for="name in loras" :key="name" class="loraItem">
            <span class="loraName">{{ name }}</span>
            <span v-if="triggerWords[name]" class="loraTrigger">{{ triggerWords[name] }}</span>
          </li>
        </ul>
        <p v-else class="panelHint">引擎未上报已装 LoRA。</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElAlert, ElSkeleton } from "element-plus";

/** 引擎档案的原始结构：limits / quality 由引擎根状态原样上报，字段以实际返回为准，这里不做字段映射。 */
type EngineProfile = {
  loras: string[];
  loraTriggerWords: Record<string, string>;
  limits: Record<string, unknown>;
  quality: Record<string, unknown>;
};

const props = defineProps<{
  /** 媒体供应商 id（如 freevideo）；为空表示还没选供应商，不发请求。 */
  providerId?: string;
}>();

const loading = ref(false);
const errorMessage = ref("");
const unsupported = ref(false);
const profile = ref<EngineProfile>();

/** 已知上限字段的中文标签；引擎没上报的字段一律显示「—」。 */
const limitLabels: Record<string, string> = {
  loras: "LoRA 数上限",
  lora_strength: "LoRA 强度区间",
  width: "宽度上限",
  height: "高度上限",
  seconds: "时长上限（秒）",
  fps: "帧率上限",
};
/** 参考图上限的键名随引擎版本变，这几个都按「参考图上限」解读，其余未识别的键按原键名展示。 */
const referenceImageKeys = ["images", "image_references", "reference_images", "max_images", "max_image_references"];
const knownLimitKeys = [...Object.keys(limitLabels), ...referenceImageKeys];

/** 引擎上报的值统一转成人读文本；缺省值显示「—」。 */
function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? value.map(item => formatValue(item)).join("、") : "—";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? entries.map(([key, item]) => `${key}: ${formatValue(item)}`).join(" · ") : "—";
  }
  return String(value);
}

/** 强度区间是 [min, max] 两元组，区间写法比「-4、4」好读。 */
function formatStrength(value: unknown): string {
  if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === "number")) {
    const range = value as number[];
    return `${range[0]} ~ ${range[1]}`;
  }
  return formatValue(value);
}

const limitRows = computed(() => {
  const limits = profile.value?.limits ?? {};
  const keys = [...knownLimitKeys, ...Object.keys(limits).filter(key => !knownLimitKeys.includes(key))];
  return keys.map(key => ({
    key,
    label: limitLabels[key] ?? (referenceImageKeys.includes(key) ? "参考图上限" : key),
    text: key === "lora_strength" ? formatStrength(limits[key]) : formatValue(limits[key]),
  }));
});

const qualityRows = computed(() => Object.entries(profile.value?.quality ?? {}).map(([key, value]) => ({ key, text: formatValue(value) })));
const loras = computed(() => profile.value?.loras ?? []);
const triggerWords = computed(() => profile.value?.loraTriggerWords ?? {});

/** 同一供应商连切时按序号丢弃过期响应，避免旧档案盖掉新供应商的数据。 */
let requestSeq = 0;

async function loadProfile() {
  const providerId = props.providerId?.trim() ?? "";
  const seq = ++requestSeq;
  errorMessage.value = "";
  unsupported.value = false;
  profile.value = undefined;
  if (!providerId) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await fetch("/api/ai/media/engineProfile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ providerId }),
    });
    const payload = await response.json().catch(() => undefined) as { data?: { supported?: boolean; profile?: EngineProfile }; message?: string } | undefined;
    if (!response.ok) throw new Error(payload?.message || `读取引擎能力档案失败（HTTP ${response.status}）`);
    if (!payload?.data) throw new Error("引擎能力档案返回为空");
    if (seq !== requestSeq) return;
    if (payload.data.supported === false) {
      unsupported.value = true;
      return;
    }
    profile.value = payload.data.profile;
  } catch (error) {
    if (seq !== requestSeq) return;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

watch(() => props.providerId, () => { void loadProfile(); }, { immediate: true });
</script>

<style scoped>
.engineProfilePanel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
}

.panelHeader {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.panelTitle {
  font-size: 13px;
  font-weight: 650;
}

.panelMeta {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panelHint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.7;
}

.profileSection {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sectionTitle {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-weight: 600;
}

.limitList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.limitRow {
  display: grid;
  grid-template-columns: minmax(84px, 120px) minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  line-height: 1.7;
}

.limitLabel {
  color: var(--el-text-color-secondary);
}

.limitValue {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
}

.loraList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.loraItem {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  line-height: 1.7;
}

.loraName {
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
}

.loraTrigger {
  color: var(--el-text-color-secondary);
}
</style>
