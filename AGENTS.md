# CLAUDE.md

## Project

Personal AI-assisted learning management system. Study materials, exam analyses, practice problems, and student profiles as structured markdown.

## Directory Structure

| Directory | Purpose |
|-----------|---------|
| `sources/{subject}/` | Learning materials |
| `sources/{subject}/exams/` | Exam analyses with wrong/difficult problem breakdowns |
| `sources/wrong_ques/` | Wrong problems archive for spaced review |
| `practice/` | Generated exercises |
| `reports/` | Study reports and progress summaries |
| `review/` | Review schedules and materials |
| `assets/` | Images and files (reference with relative paths) |
| `custom/` | `STUDENT.md` (learning state) and `PARENT.md` (goals) |
| `skills/` | Content-processing workflow definitions |

## Conventions

### File Naming
```
YYYY-MM-DD-{brief-description}.md
```

### Frontmatter
```yaml
---
source: [URL or "PDF: filename.pdf" or "Image: filename.png" or "User input"]
date: YYYY-MM-DD
subject: [subject name]
tags: [comma-separated]
type: [exam-analysis | note | raw | wrong-question | ...]
---
```

### Exam Analysis (`sources/{subject}/exams/`)
- `## 错题分析` — per incorrect problem: 题号, 题目, 正确答案, 学生答案, 错因分析
- `## 难题分析` — per difficult problem: 题号, 题目, 难点分析, 涉及知识点
- `## 总结` — `### 薄弱知识点` (ranked) and `### 建议复习方向`

## Key Skills

| Skill | Trigger | Output |
|-------|---------|--------|
| `skills/upload-raw/SKILL.md` | User uploads files (URL/PDF/image/text) | Clean markdown in `sources/{subject}/` or `sources/raw/` |
| `skills/upload-exam/SKILL.md` | User uploads exam photos | Structured analysis in `sources/{subject}/exams/` |
| `skills/generate-practice/SKILL.md` | "帮我出点题", "生成练习题" | Exercises in `practice/YYYY-MM-DD-{subject}-practice.md` |
| `skills/generate-reports/SKILL.md` | "总结一下", "学习报告" | Report in `reports/YYYY-MM-DD-{subject}-report.md` |
| `skills/generate-review/SKILL.md` | "带我复习", "复习一下" | Review session; optionally saved to `review/` |

### upload-exam Key Behavior
1. Extract problems, answers, teacher markings from images
2. Categorize: **Incorrect** (错题), **Difficult** (难题), **Normal** (ignored)
3. Error type analysis: 知识性错误, 技能性错误, 方法性错误, 审题性错误, 习惯性错误
4. Optionally update `custom/STUDENT.md` (keep ≤10 recent learning records)

### Profile Integration
Read `custom/STUDENT.md` before processing exams or generating reports. Use context to make analyses specific and actionable. Update when new evidence warrants it.
