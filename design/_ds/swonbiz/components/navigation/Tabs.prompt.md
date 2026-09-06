One-line: switches between sibling views without leaving the page.

```jsx
<Tabs items={[{label:"전체",value:"all",count:24},{label:"검토중",value:"review",count:3}]} value={t} onChange={setT} />
<Tabs variant="segmented" items={["월","분기","연"]} value={p} onChange={setP} />
```
