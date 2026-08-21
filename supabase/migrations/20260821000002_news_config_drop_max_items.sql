-- T-M8-187: ニュース一覧の「表示件数」を廃止（運営者の指示 2026-08-21）。
-- 一覧は常に全件・50件ずつのページ表示になり、news_config.max_items は使われなくなった。
-- スキーマ（settings.ts）は旧キーを黙って落とすが、保存値も掃除して「使われない値が
-- DBに残り続ける」状態を作らない（不要物の削除・T-M8-187）。
update profiles
   set news_config = news_config - 'max_items'
 where news_config ? 'max_items';
