export interface InstructionEvaluation {
  action: 'proceed' | 'clarify'
  reason?: string
  clarificationQuestion?: string
}

/**
 * Evaluates whether an editing instruction is actionable or ambiguously vague
 * (e.g. "làm cho nó hay hơn", "make it better").
 *
 * Enforces the core agent principle: "Never guess for the user. Ask clarifying questions if the request is ambiguous."
 */
export function evaluateEditingInstruction(instruction: string): InstructionEvaluation {
  const trimmed = instruction.trim().toLowerCase()
  if (!trimmed) {
    return {
      action: 'clarify',
      reason: 'EMPTY_INSTRUCTION',
      clarificationQuestion: 'Please provide specific editing instructions.',
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
          'Request is ambiguous: What action would you like to perform? (For example: cut silences, add B-roll clips, or import subtitles from SRT?)',
      }
    }
  }

  return { action: 'proceed' }
}
