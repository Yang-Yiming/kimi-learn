---
name: generate-review
description: Conduct review sessions for learned material using various methods (reports, practice, Feynman technique, etc.). Triggered by phrases like "带我复习", "复习一下", "回顾学过的内容", or when user wants structured review of past material.
---

# Generate Review Sessions

Conduct structured review of previously learned material using appropriate methods.

## Workflow

1. **Read `custom/STUDENT.md`** for learning history and weak areas
2. **Gather review materials** from `sources/{subject}/`, `sources/{subject}/exams/`, `sources/wrong_ques/`
3. **Select review method** based on user request and material type
4. **Execute review**
5. **Optionally save** to `review/YYYY-MM-DD-{subject}-review.md`

---

## Review Methods

| Method | When to use | How |
|--------|-------------|-----|
| **知识梳理** | User wants overview of what was learned | Summarize key concepts, formulas, theorems from sources; create structured outline |
| **错题重做** | User wants to practice weak areas | Select wrong problems from `sources/wrong_ques/`, present for re-attempt, then reveal solution |
| **费曼讲解** | User wants deep understanding | Have user explain a concept in their own words; ask probing questions; fill gaps |
| **综合复习** | Default; user says "复习" without specifying | Combine: brief summary + a few practice problems + identify remaining gaps |

## Time Range

- User says "今天/昨天": review last 1-2 days
- User says "这周": review past week
- User says "这个月": review past month
- User says "上次": find most recent relevant material
- No time specified: review past 2 weeks

## Output Format (if saving)

```markdown
---
date: YYYY-MM-DD
subject: [subject]
type: review
review_method: [知识梳理 | 错题重做 | 费曼讲解 | 综合复习]
time_period: [YYYY-MM-DD to YYYY-MM-DD]
tags: [...]
---

# {Subject} 复习 ({Method})

## 复习内容概览
...

## 详细复习
...

## 掌握情况评估
...

## 仍需加强的知识点
...
```

## Edge Cases

- **No materials in range**: Expand range or use profile; tell user what's available
- **Interactive methods (费曼)**: Don't save a file; the session IS the review
- **User wants to save wrong problems for later**: Save selected problems to `sources/wrong_ques/YYYY-MM-DD-{description}.md`
