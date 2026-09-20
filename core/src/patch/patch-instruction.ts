export interface InstructionEvaluation {
  action: 'proceed' | 'clarify'
  reason?: string
  clarificationQuestion?: string
}

/**
 * Evaluates whether an editing instruction is actionable or ambiguously vague
 * (e.g. "làm cho nó hay hơn", "make it better").
 *
 * Enforces the core agent principle: "Không đoán thay người dùng. Ticket nào mơ hồ thì hỏi, đừng tự chọn."
 */
export function evaluateEditingInstruction(instruction: string): InstructionEvaluation {
  const trimmed = instruction.trim().toLowerCase()
  if (!trimmed) {
    return {
      action: 'clarify',
      reason: 'EMPTY_INSTRUCTION',
      clarificationQuestion: 'Vui lòng cung cấp yêu cầu chỉnh sửa cụ thể.',
    }
  }

  // Detect purely qualitative or subjective requests without concrete parameters
  const vaguePatterns = [
    /^(làm\s+(cho\s+)?nó\s+)?(hay|đẹp|tốt|xịn|mượt|chuyên nghiệp)\s+hơn/i,
    /^(hãy\s+)?chỉnh\s+sửa\s+giùm(\s+tôi)?$/i,
    /^(make\s+it\s+)?(better|nicer|cooler|prettier|awesome|pop|cleaner)$/i,
    /^edit\s+(this|video)(\s+please)?$/i,
    /^cắt\s+bớt(\s+đi)?$/i,
  ]

  for (const pattern of vaguePatterns) {
    if (pattern.test(trimmed)) {
      return {
        action: 'clarify',
        reason: 'AMBIGUOUS_OR_SUBJECTIVE',
        clarificationQuestion:
          'Yêu cầu chưa rõ ràng: Bạn muốn thực hiện thao tác nào? (Ví dụ: cắt khoảng lặng, ghép thêm clip, hay nhập phụ đề từ SRT?)',
      }
    }
  }

  return { action: 'proceed' }
}
