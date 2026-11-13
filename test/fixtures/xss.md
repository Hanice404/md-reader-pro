# Security test

<script>window.__mdXssRan = true;</script>

<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" onerror="window.__mdXssRan = true;">

<a href="javascript:window.__mdXssRan=true">click me</a>

<iframe src="https://example.com"></iframe>

<div onclick="window.__mdXssRan=true">safe details</div>

<details>
<summary>safe details</summary>
This benign HTML should survive sanitisation.
</details>

<style>body { display: none !important; }</style>

Normal **Markdown** still renders.
