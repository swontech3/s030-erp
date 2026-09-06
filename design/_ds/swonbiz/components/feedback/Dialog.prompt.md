One-line: blocking modal for a single confirm/short form.

```jsx
<Dialog open={o} onClose={close} title="계약을 해지할까요?" description="해지 후에는 되돌릴 수 없습니다."
  footer={<><Button variant="ghost" size="sm" onClick={close}>취소</Button><Button size="sm" onClick={go}>해지</Button></>} />
```
