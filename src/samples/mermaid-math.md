# Mermaid & Math 测试

## 流程图

```mermaid
flowchart LR
    A[Markdown] --> B{Renderer}
    B --> C[HTML]
    B --> D[SVG]
```

## 时序图

```mermaid
sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi
```

## 类图

```mermaid
classDiagram
    class Document {
      +String title
      +int words
      +readingMinutes()
    }
    Document <|-- Article
```

## 状态图

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Reading: open md
    Reading --> Idle: close
```

## 数学

行内：$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$

$$
\begin{aligned}
e^{i\pi} + 1 &= 0 \\
\int_0^1 x^2 \, dx &= \frac{1}{3}
\end{aligned}
$$

## 错误图表

```mermaid
this is not a valid diagram
```

## 代码

```javascript
const x = 42;
```
