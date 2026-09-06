One-line: the SwonBiz action button — indigo primary for the single main action per view, ghost for everything secondary.

```jsx
<Button variant="primary">무료로 시작하기</Button>
<Button variant="ghost">상담 예약</Button>
<Button size="sm" variant="ghost" iconLeft={<Icon name="download" size={16} />}>내보내기</Button>
```

- Never place two `primary` buttons side by side; pair primary + ghost.
- `inverse` only on `--surface-inverse` (#0B1120) sections.
- `size="sm"` (40px) for toolbars, table rows and the ERP dashboard; 54px elsewhere.
