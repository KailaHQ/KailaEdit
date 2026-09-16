import { describe, it, expect } from 'vitest'
import { countCompletedTasks, parseEditPilotStream } from '../src/editpilot-plan'

const PLAN = [
  '<komfyedit:plan>',
  '- Cập nhật tỉ lệ khung hình',
  '- Đặt tốc độ về 1x',
  '- Tăng độ mượt',
  '</komfyedit:plan>',
].join('\n')

describe('parseEditPilotStream', () => {
  it('reads a declared plan and hides its markup from the chat', () => {
    const view = parseEditPilotStream(`Được thôi!\n${PLAN}\nBắt đầu nhé.`)
    expect(view.tasks.map(task => task.label)).toEqual([
      'Cập nhật tỉ lệ khung hình',
      'Đặt tốc độ về 1x',
      'Tăng độ mượt',
    ])
    expect(view.text).toBe('Được thôi!\nBắt đầu nhé.')
    expect(view.text).not.toContain('komfyedit')
  })

  it('marks exactly one task running while the run streams', () => {
    const view = parseEditPilotStream(`${PLAN}<komfyedit:step>1</komfyedit:step>`)
    expect(view.tasks.map(task => task.status)).toEqual(['done', 'running', 'pending'])
    expect(countCompletedTasks(view.tasks)).toBe(1)
  })

  it('leaves nothing running once the run has finished', () => {
    const raw = `${PLAN}<komfyedit:step>1</komfyedit:step><komfyedit:step>2</komfyedit:step>`
    const view = parseEditPilotStream(raw, 'finished')
    expect(view.tasks.map(task => task.status)).toEqual(['done', 'done', 'pending'])
  })

  it('accepts the self-closing step form', () => {
    const view = parseEditPilotStream(`${PLAN}<komfyedit:step n="2" />`, 'finished')
    expect(view.tasks[1].status).toBe('done')
  })

  it('completes everything on <komfyedit:done>', () => {
    const view = parseEditPilotStream(`${PLAN}<komfyedit:done/>`, 'finished')
    expect(countCompletedTasks(view.tasks)).toBe(3)
  })

  it('shows the plan while its block is still arriving', () => {
    const partial = '<komfyedit:plan>\n- Cập nhật tỉ lệ khung hình\n- Đặt tốc'
    const view = parseEditPilotStream(partial)
    // The half-typed line is not a task yet, and no raw tag leaks out.
    expect(view.tasks.map(task => task.label)).toEqual(['Cập nhật tỉ lệ khung hình'])
    expect(view.text).toBe('')
  })

  it('hides a marker that is still half-delivered', () => {
    const view = parseEditPilotStream(`${PLAN}Xong việc đầu.<komfyedit:st`)
    expect(view.text).toBe('Xong việc đầu.')
  })

  it('parses the same result no matter how the stream is chunked', () => {
    const raw = `${PLAN}<komfyedit:step>1</komfyedit:step>Đang chạy…`
    const whole = parseEditPilotStream(raw)
    let buffer = ''
    for (const character of raw) buffer += character
    expect(parseEditPilotStream(buffer)).toEqual(whole)
  })

  it('reads a state check twice the same way', () => {
    // A /g regex used with .test carries lastIndex between calls.
    const raw = `${PLAN}<komfyedit:done/>`
    expect(parseEditPilotStream(raw, 'finished')).toEqual(parseEditPilotStream(raw, 'finished'))
  })
})

describe('agents that ignore the protocol', () => {
  const prose = [
    'Tôi sẽ xử lý ngay:',
    '1. Update canvas ratio',
    '2. Update segment speeds',
    '3. Apply quality increasing',
  ].join('\n')

  it('falls back to a plain numbered list', () => {
    const view = parseEditPilotStream(prose)
    expect(view.tasks.map(task => task.label)).toEqual([
      'Update canvas ratio',
      'Update segment speeds',
      'Apply quality increasing',
    ])
    // The prose list stays in the bubble; only markers are stripped.
    expect(view.text).toBe(prose)
  })

  it('treats a clean finish as the whole list done', () => {
    const view = parseEditPilotStream(prose, 'finished')
    expect(countCompletedTasks(view.tasks)).toBe(3)
  })

  it('leaves the list unfinished when the run failed', () => {
    const view = parseEditPilotStream(prose, 'error')
    expect(countCompletedTasks(view.tasks)).toBe(0)
  })

  it('ignores numbering that does not start at 1 or is a lone item', () => {
    expect(parseEditPilotStream('Xuất ở 1080p, 2. lần thử').tasks).toEqual([])
    expect(parseEditPilotStream('1. Chỉ một việc thôi').tasks).toEqual([])
  })

  it('never invents a checklist out of ordinary prose', () => {
    const view = parseEditPilotStream('Đã đổi chữ "Default text" thành "Hello KomfyEdit".', 'finished')
    expect(view.tasks).toEqual([])
  })

  it('sanitizes technical diffs and qc_check warnings from the user bubble', () => {
    const rawWithTechNoise = [
      'Đã nhân bản text hiện tại và đặt tại giây thứ 6 thành công.',
      '### Chi tiết thay đổi:',
      '- **Diff:** `thêm 1 văn bản; V1: 5:52`',
      '- **Track tạo mới:** `V3` (track overlay phía trên)',
      '- **Vị trí bắt đầu:** `0:06.0` (giây thứ 6), thời lượng 5 giây',
      '> [!NOTE]',
      '> Cảnh báo chất lượng (`qc_check`): Cảnh báo `MISSING_MEDIA` đối với các clip dạng text...',
    ].join('\n')

    const view = parseEditPilotStream(rawWithTechNoise, 'finished')
    expect(view.text).toBe('Đã nhân bản text hiện tại và đặt tại giây thứ 6 thành công.')
    expect(view.text).not.toContain('Diff')
    expect(view.text).not.toContain('qc_check')
    expect(view.text).not.toContain('MISSING_MEDIA')
  })

  it('handles greeting, plan-first and completion message', () => {
    const rawPlanStream = [
      'Mình sẽ điều chỉnh video cho bạn ngay nhé!',
      '1. Dọn dẹp từ thừa và đoạn trống',
      '2. Cắt ngắn video còn 1 phút',
      '<komfyedit:plan>',
      '- Dọn dẹp từ thừa và đoạn trống',
      '- Cắt ngắn video còn 1 phút',
      '</komfyedit:plan>',
      '<komfyedit:step>1</komfyedit:step>',
      '<komfyedit:step>2</komfyedit:step>',
      '<komfyedit:done/>',
      'Đã hoàn thành! Mình đã cắt ngắn video còn 1 phút cho bạn rồi nhé.',
    ].join('\n')

    const view = parseEditPilotStream(rawPlanStream, 'finished')
    expect(view.tasks.map(t => t.label)).toEqual([
      'Dọn dẹp từ thừa và đoạn trống',
      'Cắt ngắn video còn 1 phút',
    ])
    expect(view.tasks.every(t => t.status === 'done')).toBe(true)
    expect(view.text).toContain('Mình sẽ điều chỉnh video cho bạn ngay nhé!')
    expect(view.text).toContain('Đã hoàn thành! Mình đã cắt ngắn video còn 1 phút cho bạn rồi nhé.')
    expect(view.text).not.toContain('komfyedit')
  })

  it('supports <coedit:plan>, <coedit:step>, and <coedit:done>', () => {
    const rawPlanStream = [
      'Bắt đầu dựng cùng CoEdit nhé!',
      '<coedit:plan>',
      '- Tối ưu màu sắc',
      '- Chèn hiệu ứng chuyển cảnh',
      '</coedit:plan>',
      '<coedit:step>1</coedit:step>',
      '<coedit:done/>',
      'Đã hoàn tất chỉnh sửa!',
    ].join('\n')

    const view = parseEditPilotStream(rawPlanStream, 'finished')
    expect(view.tasks.map(t => t.label)).toEqual([
      'Tối ưu màu sắc',
      'Chèn hiệu ứng chuyển cảnh',
    ])
    expect(view.tasks.every(t => t.status === 'done')).toBe(true)
    expect(view.text).toBe('Bắt đầu dựng cùng CoEdit nhé!\nĐã hoàn tất chỉnh sửa!')
  })
})

