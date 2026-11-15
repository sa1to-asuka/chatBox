import { Select } from '../base/Select.js'
import { loadModels, selectModel, useModels } from '../../services/models.js'
import styles from './ModelPicker.module.css'

export const ModelPicker = () => {
  const { models, selected, loaded, error } = useModels()
  if (!loaded || models.length === 0) {
    return <div className={styles.empty}>
      {error ? <><span>模型加载失败</span><button type="button" onClick={() => void loadModels()}>重试</button></> : null}
      {!error && !loaded ? <span>正在加载模型…</span> : null}
      {!error && loaded ? <span>暂无可用模型</span> : null}
    </div>
  }
  return <div className={styles.wrap}>
    <Select
      ariaLabel="选择 AI 模型"
      variant="ghost"
      className={styles.select}
      value={selected}
      options={models.map((model) => ({
        value: model.id,
        label: model.name,
        badge: model.premium ? 'VIP' : undefined,
        hint: model.multiplier === 1 ? undefined : `${model.multiplier}×`,
      }))}
      onChange={selectModel}
    />
  </div>
}
