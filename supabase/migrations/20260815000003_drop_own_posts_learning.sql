-- 「自分の過去投稿から学習」（own_posts・PT-L3）の廃止（T-M8-103）。
-- 毎朝の投稿分析（K-2・SUGGEST）が自分の投稿の分析を担うため重複機能になった。
-- enum learning_source_type の 'own_posts' 値は残す（値の削除はテーブル書き換えが必要で、
-- 参照が無ければ実害もない）。既存の own_posts 行は削除する。
-- 注意: 過去に own_posts の知見がアカウント.md（base_md）のセクション5へ反映済みの場合、
-- その文章は次の MD-MERGE（参考ソースの追加/削除時）で再構築されるまで残る。
delete from learning_sources where type = 'own_posts';
