---
name: upload-raw
description: Process learning resources (webpages, PDFs, images, text) into markdown and save to the sources directory. AutoTrigger only when user upload files/sources and STRESS store it raw, or user manually activate. Converts raw content into clean markdown without losing much information.
---

# Upload Raw Learning Materials

Convert various learning resources into markdown files stored in `sources/{subject}/` or `sources/raw/`.

---

## Step 1: Identify Input Type

- **URL**: Use `WebFetch` to retrieve content. Notice User if fail.
- **PDF / Image**: `Read` Directly. If you can't read image, warn/notice the user.
- **Plain text**: process directly

If multiple inputs are provided, process each one sequentially.

---

## Step 2: Extract & Write

- **URL**: Fetch the main article content. Ignore navigation menus, ads, sidebars, footers, and comment sections. Focus on the primary text body.
- **URL**: Extract main content (ignore menus, ads, etc).
- **PDF & Image**: Extract main text content, save image to `assets/{}` IF NEEDED and refrence in md file. 
- **Text**: Use the text as-is.

## Step 3: Determine subject & Save

Determine where the file should be save/put in `sources/`, Create the directory if it does not exist.

Then write the content to markdown file (in Markdown format) in `sources/{subject}`.

### Filename Format
```
YYYY-MM-DD-{brief-description}.md
```
- Examples: `2025-04-27-quadratic-functions.md`, `2025-04-27-二次函数综合复习.md`

### File Header Template
```markdown
---
source: [URL or "PDF: filename.pdf" or "Image: filename.png" or "User input"]
date: YYYY-MM-DD
subject: [subject name]
tags: [relevant tags, comma-separated]
---
```

## Edge Cases

- Just warn the user and stop processing if you are not sure.
