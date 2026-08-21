-- T-M8-192（レビュー指摘の修正）: 既存profilesのnews_config.categoriesを6分野運用へ追随させる。
--
-- 20260822000001 は新規登録の既定だけを変えたため、既存ユーザーには love/beauty（と
-- 2026-08-02以降の登録者には web3 も）のダイジェスト通知が**設定を自分で変えない限り永久に
-- 届かない**状態だった（通知のfan-outは保存済みjsonbのcategoriesと突き合わせる）。
--
-- 更新するのは**旧既定値をそのまま持つ行だけ**（集合として一致で判定）。利用者が意図的に
-- 分野を絞った設定は上書きしない。旧既定は2種類:
--   (a) 2026-07-22〜08-02 登録: ai/web3/investment/business/business_ops/sns（20260720000002）
--   (b) 2026-08-02〜08-22 登録: ai/investment/sns（20260802000001・T-M7-55）
update profiles
   set news_config = jsonb_set(
         news_config,
         '{categories}',
         '["ai", "web3", "sns", "investment", "love", "beauty"]'::jsonb
       )
 where (
         select array_agg(value order by value)
           from jsonb_array_elements_text(news_config->'categories')
       ) in (
         array['ai', 'business', 'business_ops', 'investment', 'sns', 'web3'],
         array['ai', 'investment', 'sns']
       );
