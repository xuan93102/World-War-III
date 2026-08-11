// Maps each of the ~59 sub-regions from docs/game-design.md section 3.1 to
// the real township (鄉鎮市區) names that make it up, per taiwan-atlas.
// Every township in the 19 target counties must appear exactly once across
// this file — build-map-data.mjs validates that at build time.
//
// Where the design doc's group name didn't literally list every township
// in that area (it named a handful of representative towns per group), the
// remaining nearby real towns were folded into the geographically closest
// named group so the whole county is covered with no gaps.

export const SUBREGIONS = [
  // ---- north (18) ----
  { id: 'taipei-1', name: '北投士林', county: '台北市', area: 'north', towns: ['北投區', '士林區'] },
  { id: 'taipei-2', name: '內湖南港', county: '台北市', area: 'north', towns: ['內湖區', '南港區'] },
  { id: 'taipei-3', name: '中山大同', county: '台北市', area: 'north', towns: ['中山區', '大同區'] },
  { id: 'taipei-4', name: '松山信義', county: '台北市', area: 'north', towns: ['松山區', '信義區'] },
  { id: 'taipei-5', name: '中正大安萬華文山', county: '台北市', area: 'north', towns: ['中正區', '大安區', '萬華區', '文山區'] },

  { id: 'newtaipei-1', name: '板橋中永和', county: '新北市', area: 'north', towns: ['板橋區', '中和區', '永和區'] },
  { id: 'newtaipei-2', name: '新莊三重蘆洲', county: '新北市', area: 'north', towns: ['新莊區', '三重區', '蘆洲區', '泰山區', '五股區'] },
  { id: 'newtaipei-3', name: '淡水三芝石門', county: '新北市', area: 'north', towns: ['淡水區', '三芝區', '石門區'] },
  { id: 'newtaipei-4', name: '瑞芳貢寮雙溪平溪', county: '新北市', area: 'north', towns: ['瑞芳區', '貢寮區', '雙溪區', '平溪區'] },
  { id: 'newtaipei-5', name: '土城樹林鶯歌三峽', county: '新北市', area: 'north', towns: ['土城區', '樹林區', '鶯歌區', '三峽區', '新店區', '深坑區', '石碇區', '坪林區', '烏來區'] },
  { id: 'newtaipei-6', name: '汐止萬里金山', county: '新北市', area: 'north', towns: ['汐止區', '萬里區', '金山區'] },
  { id: 'newtaipei-7', name: '林口八里', county: '新北市', area: 'north', towns: ['林口區', '八里區'] },

  { id: 'keelung-1', name: '基隆市', county: '基隆市', area: 'north', towns: ['暖暖區', '七堵區', '仁愛區', '信義區', '中正區', '中山區', '安樂區'] },

  { id: 'taoyuan-1', name: '桃園中壢', county: '桃園市', area: 'north', towns: ['桃園區', '中壢區', '龜山區', '平鎮區'] },
  { id: 'taoyuan-2', name: '八德大溪龍潭', county: '桃園市', area: 'north', towns: ['八德區', '大溪區', '龍潭區', '復興區'] },
  { id: 'taoyuan-3', name: '蘆竹大園觀音新屋', county: '桃園市', area: 'north', towns: ['蘆竹區', '大園區', '觀音區', '新屋區', '楊梅區'] },

  { id: 'hsinchucity-1', name: '新竹市', county: '新竹市', area: 'north', towns: ['北區', '香山區', '東區'] },

  { id: 'hsinchucounty-1', name: '新竹縣', county: '新竹縣', area: 'north', towns: ['竹北市', '竹東鎮', '新埔鎮', '關西鎮', '湖口鄉', '芎林鄉', '橫山鄉', '北埔鄉', '尖石鄉', '五峰鄉', '新豐鄉', '寶山鄉', '峨眉鄉'] },

  // ---- central (14) ----
  { id: 'miaoli-1', name: '苗栗竹南', county: '苗栗縣', area: 'central', towns: ['苗栗市', '竹南鎮', '頭份市', '造橋鄉', '後龍鎮', '通霄鎮', '苑裡鎮', '西湖鄉', '銅鑼鄉', '公館鄉', '頭屋鄉'] },
  { id: 'miaoli-2', name: '大湖卓蘭', county: '苗栗縣', area: 'central', towns: ['大湖鄉', '卓蘭鎮', '三義鄉', '三灣鄉', '南庄鄉', '獅潭鄉', '泰安鄉'] },

  { id: 'taichung-1', name: '中西東南北屯', county: '台中市', area: 'central', towns: ['中區', '西區', '南區', '東區', '北區', '北屯區'] },
  { id: 'taichung-2', name: '西屯南屯', county: '台中市', area: 'central', towns: ['西屯區', '南屯區'] },
  { id: 'taichung-3', name: '大甲清水沙鹿梧棲', county: '台中市', area: 'central', towns: ['大甲區', '清水區', '沙鹿區', '梧棲區', '大安區', '龍井區', '大肚區'] },
  { id: 'taichung-4', name: '豐原潭子大雅神岡', county: '台中市', area: 'central', towns: ['豐原區', '潭子區', '大雅區', '神岡區', '后里區', '外埔區'] },
  { id: 'taichung-5', name: '太平大里霧峰烏日', county: '台中市', area: 'central', towns: ['太平區', '大里區', '霧峰區', '烏日區'] },
  { id: 'taichung-6', name: '東勢和平石岡', county: '台中市', area: 'central', towns: ['東勢區', '和平區', '石岡區', '新社區'] },

  { id: 'changhua-1', name: '彰化員林', county: '彰化縣', area: 'central', towns: ['彰化市', '員林市', '和美鎮', '線西鄉', '伸港鄉', '秀水鄉', '花壇鄉', '芬園鄉', '大村鄉', '埔鹽鄉', '埔心鄉', '鹿港鎮', '福興鄉'] },
  { id: 'changhua-2', name: '北斗溪湖', county: '彰化縣', area: 'central', towns: ['北斗鎮', '溪湖鎮', '田中鎮', '社頭鄉', '永靖鄉', '二水鄉', '二林鎮', '埤頭鄉', '芳苑鄉', '大城鄉', '竹塘鄉', '溪州鄉', '田尾鄉'] },

  { id: 'nantou-1', name: '南投草屯', county: '南投縣', area: 'central', towns: ['南投市', '草屯鎮', '中寮鄉', '名間鄉', '竹山鎮', '鹿谷鄉', '集集鎮', '水里鄉'] },
  { id: 'nantou-2', name: '埔里魚池仁愛信義', county: '南投縣', area: 'central', towns: ['埔里鎮', '魚池鄉', '仁愛鄉', '信義鄉', '國姓鄉'] },

  { id: 'yunlin-1', name: '斗六斗南', county: '雲林縣', area: 'central', towns: ['斗六市', '斗南鎮', '古坑鄉', '林內鄉', '大埤鄉', '莿桐鄉'] },
  { id: 'yunlin-2', name: '虎尾北港', county: '雲林縣', area: 'central', towns: ['虎尾鎮', '北港鎮', '西螺鎮', '土庫鎮', '二崙鄉', '崙背鄉', '東勢鄉', '褒忠鄉', '元長鄉', '水林鄉', '臺西鄉', '四湖鄉', '口湖鄉', '麥寮鄉'] },

  // ---- south (19) ----
  { id: 'chiayicity-1', name: '嘉義市', county: '嘉義市', area: 'south', towns: ['東區', '西區'] },
  { id: 'chiayicounty-1', name: '民雄大林', county: '嘉義縣', area: 'south', towns: ['民雄鄉', '大林鎮', '溪口鄉', '新港鄉', '太保市', '水上鄉', '竹崎鄉', '梅山鄉', '番路鄉', '中埔鄉', '大埔鄉', '阿里山鄉'] },
  { id: 'chiayicounty-2', name: '朴子布袋', county: '嘉義縣', area: 'south', towns: ['朴子市', '布袋鎮', '東石鄉', '六腳鄉', '義竹鄉', '鹿草鄉'] },

  { id: 'tainan-1', name: '中西東安南永康', county: '台南市', area: 'south', towns: ['中西區', '東區', '安南區', '南區', '永康區', '安平區', '北區'] },
  { id: 'tainan-2', name: '新營鹽水白河', county: '台南市', area: 'south', towns: ['新營區', '鹽水區', '白河區', '後壁區', '柳營區', '東山區', '六甲區', '官田區', '大內區'] },
  { id: 'tainan-3', name: '佳里麻豆學甲', county: '台南市', area: 'south', towns: ['佳里區', '麻豆區', '學甲區', '下營區', '西港區', '北門區'] },
  { id: 'tainan-4', name: '新化玉井楠西左鎮', county: '台南市', area: 'south', towns: ['新化區', '玉井區', '楠西區', '南化區', '左鎮區', '新市區', '善化區', '山上區'] },
  { id: 'tainan-5', name: '關廟仁德歸仁', county: '台南市', area: 'south', towns: ['關廟區', '仁德區', '歸仁區', '龍崎區'] },
  // 安定區 is split off: it doesn't touch 將軍/七股 (西港區, in tainan-3, sits
  // between them), so keeping them as one region meant one "territory" made
  // of two separate patches of land.
  { id: 'tainan-6', name: '將軍七股', county: '台南市', area: 'south', towns: ['將軍區', '七股區'] },
  { id: 'tainan-7', name: '安定', county: '台南市', area: 'south', towns: ['安定區'] },

  { id: 'kaohsiung-1', name: '苓雅前鎮新興鹽埕', county: '高雄市', area: 'south', towns: ['苓雅區', '前鎮區', '新興區', '鹽埕區', '前金區', '旗津區', '鼓山區'] },
  { id: 'kaohsiung-2', name: '三民左營楠梓', county: '高雄市', area: 'south', towns: ['三民區', '左營區', '楠梓區', '梓官區', '鳥松區'] },
  { id: 'kaohsiung-3', name: '鳳山大寮林園', county: '高雄市', area: 'south', towns: ['鳳山區', '大寮區', '林園區', '大樹區'] },
  { id: 'kaohsiung-4', name: '岡山路竹橋頭', county: '高雄市', area: 'south', towns: ['岡山區', '路竹區', '橋頭區', '燕巢區', '田寮區', '阿蓮區', '湖內區'] },
  { id: 'kaohsiung-5', name: '旗山美濃六龜', county: '高雄市', area: 'south', towns: ['旗山區', '美濃區', '六龜區', '甲仙區', '杉林區', '內門區', '茂林區', '桃源區', '那瑪夏區'] },
  { id: 'kaohsiung-6', name: '茄萣永安彌陀', county: '高雄市', area: 'south', towns: ['茄萣區', '永安區', '彌陀區'] },
  // 小港區 is split off: it sits down by the harbour, nowhere near inland
  // 仁武/大社.
  { id: 'kaohsiung-7', name: '仁武大社', county: '高雄市', area: 'south', towns: ['仁武區', '大社區'] },
  { id: 'kaohsiung-8', name: '小港', county: '高雄市', area: 'south', towns: ['小港區'] },

  // 潮州鎮 is split off: it's further south, cut off from the 屏東市 cluster by
  // the 東港林邊 group's townships.
  { id: 'pingtung-1', name: '屏東市', county: '屏東縣', area: 'south', towns: ['屏東市', '長治鄉', '麟洛鄉', '九如鄉', '里港鄉', '鹽埔鄉', '高樹鄉', '三地門鄉', '霧臺鄉', '瑪家鄉', '萬丹鄉'] },
  { id: 'pingtung-4', name: '潮州', county: '屏東縣', area: 'south', towns: ['潮州鎮'] },
  { id: 'pingtung-2', name: '東港林邊', county: '屏東縣', area: 'south', towns: ['東港鎮', '林邊鄉', '新園鄉', '崁頂鄉', '南州鄉', '佳冬鄉', '竹田鄉', '萬巒鄉', '內埔鄉', '新埤鄉', '泰武鄉', '來義鄉', '琉球鄉'] },
  { id: 'pingtung-3', name: '恆春車城', county: '屏東縣', area: 'south', towns: ['恆春鎮', '車城鄉', '滿州鄉', '枋山鄉', '牡丹鄉', '枋寮鄉', '春日鄉', '獅子鄉'] },

  // ---- east (8) ----
  { id: 'yilan-1', name: '宜蘭羅東', county: '宜蘭縣', area: 'east', towns: ['宜蘭市', '羅東鎮', '壯圍鄉', '員山鄉', '五結鄉', '冬山鄉', '三星鄉'] },
  // 蘇澳鎮 is split off: it's south of the Yilan plain and doesn't touch
  // 頭城/礁溪 up on the northern coast.
  { id: 'yilan-2', name: '頭城礁溪', county: '宜蘭縣', area: 'east', towns: ['頭城鎮', '礁溪鄉'] },
  { id: 'yilan-4', name: '蘇澳', county: '宜蘭縣', area: 'east', towns: ['蘇澳鎮'] },
  { id: 'yilan-3', name: '大同南澳', county: '宜蘭縣', area: 'east', towns: ['大同鄉', '南澳鄉'] },

  { id: 'hualien-1', name: '花蓮吉安', county: '花蓮縣', area: 'east', towns: ['花蓮市', '吉安鄉', '壽豐鄉'] },
  { id: 'hualien-2', name: '玉里瑞穗', county: '花蓮縣', area: 'east', towns: ['玉里鎮', '瑞穗鄉', '光復鄉', '富里鄉', '鳳林鎮', '卓溪鄉', '豐濱鄉'] },
  { id: 'hualien-3', name: '秀林新城', county: '花蓮縣', area: 'east', towns: ['秀林鄉', '新城鄉', '萬榮鄉'] },

  { id: 'taitung-1', name: '台東卑南', county: '台東縣', area: 'east', towns: ['臺東市', '卑南鄉', '鹿野鄉', '池上鄉', '關山鎮', '海端鄉', '延平鄉', '成功鎮', '東河鄉', '長濱鄉', '綠島鄉'] },
  { id: 'taitung-2', name: '大武太麻里', county: '台東縣', area: 'east', towns: ['大武鄉', '太麻里鄉', '達仁鄉', '金峰鄉', '蘭嶼鄉'] },
];

// The 5 mountain chokepoints (docs/game-design.md 3.2), mapped to the real
// sub-region pair each corridor actually runs between. build-map-data.mjs
// validates each pair is a real geographic neighbor and prunes every other
// west/east cross-area edge, so these 5 stay the only crossable connections.
export const MOUNTAIN_PASSES = [
  { from: 'newtaipei-5', to: 'yilan-2', name: '北宜' },
  { from: 'taichung-6', to: 'hualien-3', name: '中橫' },
  { from: 'nantou-2', to: 'hualien-3', name: '能高越嶺' },
  { from: 'kaohsiung-5', to: 'taitung-1', name: '南橫' },
  { from: 'pingtung-3', to: 'taitung-2', name: '南迴' },
];
