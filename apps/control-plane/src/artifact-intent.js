export function requestedArtifactFormat(content) {
  const text = String(content || '').toLowerCase();
  const englishDeliverableIntent = /\b(create|generate|prepare|produce|make|export|provide|send|attach|render|draft)\b/.test(text);
  const englishTemplateIntent = /\b(?:use|fill(?:\s+(?:in|out))?|complete|populate|apply)\b[\s\S]{0,100}\b(?:template|form|report)\b/.test(text);
  const chineseActionIntent = /(?:生成|產生|产生|建立|創建|创建|製作|制作|編製|编制|準備|准备|匯出|汇出|導出|导出|輸出|输出|提供|發送|发送|傳送|传送|轉成|转成|轉換成|转换成|做(?:一|個|个|份)?|整(?:一|個|个|份)?|出(?:一|個|个|份)?|發(?:一|個|个|份)?|发(?:一|個|个|份)?)/u.test(text);
  const chineseTemplateIntent = /(?:套用|填寫|填写|填充|完成).{0,40}(?:範本|模板|表格|表單)/u.test(text);
  const chineseRequestIntent = /(?:請|请|麻煩|麻烦|唔該|唔该|可否|能否|可以|可唔可以|幫我|帮我|幫手|帮忙)/u.test(text);
  const deliverableIntent = englishDeliverableIntent || englishTemplateIntent || chineseActionIntent || chineseTemplateIntent || chineseRequestIntent;
  if (!deliverableIntent) return '';
  if (/\b(pdf|portable document format)\b|(?:可攜式文件|便攜式文件|便携式文档)/u.test(text)) return 'pdf';
  if (/\b(docx|word document|word file|microsoft word)\b|(?:word\s*(?:文件|文檔|文档)|微軟\s*word|微软\s*word)/u.test(text)) return 'docx';
  if (/\b(image|graphic|infographic|illustration|picture)\b|(?:圖片|图片|圖像|图像|影像|插圖|插图|信息圖|信息图|資訊圖|资讯图)/u.test(text)) return 'image';
  if (/\b(generate|create|prepare|produce|make|export|provide|send|attach|render|draft)\b[\s\S]{0,80}\breport\b|\breport\b[\s\S]{0,80}\b(generate|create|prepare|produce|make|export|provide|send|attach|render|draft)\b/.test(text)) return 'pdf';
  if (englishTemplateIntent || chineseTemplateIntent) return 'pdf';
  if ((chineseActionIntent || chineseRequestIntent) && /(?:報告|报告)/u.test(text)) return 'pdf';
  return '';
}
