---
date: 2026-09-27
type: ops
project: aidlc-workflow
title: aidlc-workflowリポジトリ新設
status: done
decision: AWS aidlc-workflowsをcloneして独立リポジトリaidlc-workflowを新設し、GitHubルートのルーティング表に追記した
tags: [aidlc, aws, repo-setup, git]
---

# aidlc-workflowリポジトリ新設

## 1. 依頼

「AWSのAI-DLC Workflow v2をベースとした開発環境を構築したい。
`https://github.com/awslabs/aidlc-workflows`がベースになるはずだけど、
どうやってダウンロードしてくればいいか」という依頼。

## 2. 前提・制約

- 作業ルートは `C:\Users\topge\OneDrive\ドキュメント\GitHub\`（非gitの並立作業ルート）。
- 同ルート直下の`CLAUDE.md`により、現役リポジトリはルーティング表に載る5件のみと
  定められており、新規リポジトリの切り出しは「複数セッションにわたり資料が
  継続的に積み上がる見込み」が要件、かつ迷う場合は殿に伺いを立てる規約。
- 「開発環境を構築したい」という依頼の性質上、今後複数セッションにわたり
  実装・設定が積み上がる継続案件になることは、依頼の時点でほぼ明確だった。

## 3. 検討した選択肢

| 案 | 長所 | 短所 | 採否 | 却下理由 |
|---|---|---|---|---|
| `claude_playground`に置く | デフォルト置き場で判断コストが低い | 用途混在。継続案件と分かっている以上、後日の切り出しコストが二度手間になる | 却下 | 継続性が依頼時点で明確なため、デフォルト置き場を経由する理由がない |
| 新規独立リポジトリを切る | 用途専用でルーティング表から追跡可能。fork/upstream運用など通常のOSS開発フローに乗せやすい | 初期セットアップ（ルーティング表更新・remote整理）の手間が発生 | 採用 | - |
| 作業ルート外（scratchpad等）に一時clone | 中身を見るだけなら手軽 | リポジトリ資産として残らず、継続開発の土台にならない | 却下 | 「開発環境を構築したい」という目的に対し使い捨てでは要件を満たさない |

## 4. 決定と決め手

殿の指示により新規独立リポジトリ`aidlc-workflow`を新設し、GitHubルート直下に
`git clone`した。決め手は、依頼内容（AI-DLC Workflow v2ベースの開発環境構築）が
性質上、複数セッションにわたり資料・実装が積み上がる継続案件であることが
依頼の時点で既に明確だった点。運用規約の「継続性が見えてきた場合に切り出しを
検討する」を満たすため、`claude_playground`を経由せず直接独立リポジトリとした。

## 5. やったこと

- 成果物：`C:\Users\topge\OneDrive\ドキュメント\GitHub\aidlc-workflow`（`awslabs/aidlc-workflows`のclone）
- `C:\Users\topge\OneDrive\ドキュメント\GitHub\CLAUDE.md` のルーティング表に
  `aidlc-workflow`の行を追加（現役リポジトリを5件→6件に更新）。
- clone直後は`origin`がAWS本家（`awslabs/aidlc-workflows`）を指すため、
  誤push防止で`origin`→`upstream`への改名を試みたが、ハーネスの
  `block-dangerous.ps1`が`git remote * (set-url|add|remove|rename)`を
  一括denyしており実行不可。殿ご自身のターミナルでの実行に委ねることとし、
  信玄側では未実施のまま完了とした。

## 6. 見直し条件

AWS本家へのPR提出やforkベースの開発フローが必要になった場合、
remote構成（upstream/origin）を再設計する。

## 7. 未解決・次の一手

- `git remote rename origin upstream` は殿ご自身の実行待ち（信玄・subagent経由では
  ハーネスのdenyフックによりブロックされる）。
- 依存関係のインストールや実際の開発環境セットアップ（`README.md`/`DEVELOPERS.md`
  参照）は未着手。次回セッションで着手予定。

## memory昇格候補

OSSを土台に新規リポジトリをcloneしorigin改名が必要な場面では、
`git remote rename`はハーネスの`block-dangerous.ps1`（`set-url|add|remove|rename`を
一括deny）でブロックされ、殿ご自身の実行でのみ回避できる。今後の同種作業で
再度説明の手間が生じるため、memoryに昇格する価値あり。
