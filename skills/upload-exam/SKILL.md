---
name: upload-exam
description: 处理用户上传的试卷、作业、题目等学习相关的内容，提取其中关键信息形成结构化 markdown 并更新用户画像。
---

# Upload and Analyze Exam Papers

Process exam/test images to extract problems, analyze errors, identify weak areas, and update learning profiles.

## Workflow

1. **Read exam images/files**
2. **Identify all problems and markings**
3. **Analyze incorrect problems**
4. **Analyze difficult problems**
5. **Generate structured markdown**
6. **Save to sources directory**
7. **Optionally update student profile**

---

## Step 1: Read Exam Images

Accept one or more images of test papers. Read each image carefully to extract:

- Exam title, subject, date (if visible)
- All problems with their numbers and full text
- Student's answers (written or marked)
- Teacher's corrections, marks, or comments
- Any symbols indicating wrong answers (crosses, minus signs, red marks) or difficult problems (stars, circles, highlights)

If the image quality is poor or text is unreadable, ask the user for clearer images.

---

## Step 2: Read user Identity

Read `custom/*` 找到一些与当前学科相关的信息。

## Step 2: Identify Problems and Markings

Categorize each problem into one of three types:

| Category | Identification |
|----------|---------------|
| **Incorrect** (错题) | Marked wrong by teacher, crossed out, or student answer differs from correct answer |
| **Difficult** (难题) | 有标记或你根据用户画像认为有必要涵盖 |
| **Normal** (普通题) | No special markings, answered correctly | 

For each incorrect problem, record:
- Problem number and full text
- Student's answer
- Correct answer (if visible on paper or inferable)
- Any teacher comments

For each difficult problem, record:
- Problem number and full text
- How it is related to student's 学习状态

Ignore normal problems.

---

## Step 3: Analyze & Generate

Analyze each incorrect problem and generate structured output. Example Error types for reference:

- **知识性错误**: 概念模糊、公式记错、定理误用、知识点盲区
- **技能性错误**: 计算粗心、运算不规范、代数变形错误
- **方法性错误**: 方法选择不当、解题策略缺失、分类讨论不全
- **审题性错误**: 条件遗漏、关键词误读、隐含条件未发现
- **习惯性错误**: 跳步严重、书写潦草、草稿混乱

For each wrong problem, include: 题号、题目、正确答案、学生答案、错因分析（根因 + 涉及知识点 + 改进建议）. Be specific — name the exact mistake, not just "粗心".

If difficult problems are marked (stars/circles), briefly note them with: 题号、题目、难点分析、涉及知识点.

---

## Step 4: Save

Save to `sources/{subject}/exams/YYYY-MM-DD-{exam-name}.md`.

Template:
```markdown
---
source: "Exam: {exam name}"
date: YYYY-MM-DD
subject: {subject}
type: exam-analysis
tags: [...]
---

# {Exam Title}

## 错题分析

{Each incorrect problem with analysis}

## 难题分析（可选）

{Each difficult problem if any}

## 总结

### 薄弱知识点
{Weak areas ranked by frequency}

### 建议复习方向
1. ...
2. ...
3. ...
```

---

## Step 5: Update Student Profile (Optional)

如果你觉得本次考试可以看出学生画像的一些变化, read `custom/STUDENT.md` and update:
- **学科能力** — adjust ratings with trend (↑/→/↓)
- **常见错误类型** — add new ones, update frequency and "最近出现" date
- **薄弱领域/擅长领域** — update with evidence from this exam
- **近期学习记录** — append new entry at the top (keep ≤10 entries)

---

## Edge Cases

- **Partial/cropped images**: Ask for missing parts or note which problems couldn't be read.
- **No markings visible**: Ask user which problems were wrong, or process as a general summary.
- **Answer key not visible**: Analyze based on visible corrections; note if unverifiable.
- **Multi-page / multi-subject**: Process together per exam; split files by subject if needed.
