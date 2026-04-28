---
name: generate-reports
description: Summarize user's recent learning progress and status. Triggered by phrases like "总结一下学习情况", "这周学了什么", "学习报告", or when user asks for progress review over a time period.
---

# Generate Learning Reports

Summarize learning activity over a specified time period based on profile and source materials.

## Workflow

1. **Read `custom/STUDENT.md`** for baseline and recent learning records
2. **Gather recent materials** from `sources/{subject}/`, `sources/{subject}/exams/`, `practice/`
3. **Generate report**
4. **Save** to `reports/YYYY-MM-DD-{subject}-report.md`

---

## What to Include

| Section | Content |
|---------|---------|
| 学习概览 | Time period, subjects covered, total materials/exams/practice sessions |
| 错题与薄弱点 | New weak areas identified, recurring error types, trends vs. previous period |
| 进步与亮点 | Areas showing improvement, consistently correct topics |
| 建议 | Specific next steps based on patterns |

## Time Period Resolution

- User says "这周": check current week (Mon-Sun)
- User says "这个月": check current month
- User says "最近": default to past 2 weeks
- Specific dates: use exact range

## Output Format

```markdown
---
date: YYYY-MM-DD
subject: [subject or "综合"]
type: report
time_period: [YYYY-MM-DD to YYYY-MM-DD]
tags: [...]
---

# {Subject} 学习报告 ({Time Period})

## 学习概览
...

## 错题与薄弱点分析
...

## 进步与亮点
...

## 下阶段建议
...
```

## Edge Cases

- **No recent materials**: Report based on profile only; note limited data
- **No profile**: Infer from materials alone
- **Very little data**: Generate brief summary, suggest collecting more materials
