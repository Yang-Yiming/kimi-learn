---
name: generate-practice
description: Generate practice problems based on user profile and recent learning materials. Triggered by phrases like "帮我出点题", "生成练习题", "给我一些练习", "出几道数学题", or when user wants targeted practice.
---

# Generate Practice Problems

Create customized practice problems based on user profile, recent materials, and specific requests.

## Workflow

1. **Read `custom/STUDENT.md`** for weak areas, recent topics, ability levels
2. **Gather sources** from `sources/{subject}/exams/` (recent wrong problems) or `sources/{subject}/` (recent notes)
3. **Generate problems** matching user constraints
4. **Save** to `practice/YYYY-MM-DD-{subject}-practice.md`

---

## Problem Sources

| Source | When to use |
|--------|-------------|
| Modified wrong problems | User wants to practice weak areas; take from `sources/wrong_ques/` or exam analyses, change numbers/conditions |
| AI-generated new problems | User wants fresh material on specific topics |
| Mixed | Default — some reinforcement, some challenge |

## Constraints

- **Quantity**: Default 5-10; respect explicit limits ("不要太多" → 3-5)
- **Difficulty**: Harder than current level for growth, easier for confidence; ask if unclear
- **Topic**: Prioritize weak areas unless user specifies otherwise

## Output Format

```markdown
---
date: YYYY-MM-DD
subject: [subject]
type: practice
tags: [...]
---

# {Subject} 练习题

## 题目

### 第1题
[题目内容]

## 参考答案与解析

### 第1题
**答案**: ...
**解析**: ...
**涉及知识点**: ...
```

## Edge Cases

- **No profile**: Generate based on general curriculum standards
- **No source materials**: Create AI-generated problems, note this to user
- **Unclear difficulty**: Ask "是基础巩固还是提高挑战？"
