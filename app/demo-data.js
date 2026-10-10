(function(root){
'use strict';
/* 演示目录：全部为虚构数据。食品图是原创演示示意，不是官方商品实拍。
   辣度／油腻感等属性刻意保留 unknown，用于验证“证据不足时如实说明”而非伪造匹配。 */
const names=['当店套餐','自由组合','1+1','单人餐','多人分享','开心乐园餐','500大卡套餐','汉堡／卷','鸡肉','小食','甜品','饮品'];
const categories=names.map((name,i)=>({id:'c'+i,name}));
const rows=[
/*  id        name          role    minor art     taste   categories     family   texture                     spice                     richness*/
['crispy','香脆鸡腿堡','main',1800,'crispy','香脆',[0,1,3,7],'burger',['crispy','labeled'],[1,'unknown'],['rich','unknown']],
['beef','浓香牛肉堡','main',2200,'burger','浓郁',[0,1,3,7],'burger',['soft','labeled'],[0,'labeled'],['rich','unknown']],
['fish','清新鱼排堡','main',2100,'fish','清爽',[1,3,7],'burger',['soft','labeled'],[0,'labeled'],['light','labeled']],
['wrap','田园鸡肉卷','main',1800,'wrap','清爽',[1,7],'wrap',['soft','labeled'],[0,'labeled'],['light','labeled']],
['fries','金黄薯条','side',1000,'fries','香脆',[1,2,9],'side',['crispy','labeled'],[0,'labeled'],['rich','unknown']],
['nuggets','酥酥鸡块','side',1300,'nuggets','香脆',[1,2,8,9],'side',['crispy','labeled'],[1,'unknown'],['rich','unknown']],
['corn','甜玉米杯','side',800,'corn','清爽',[1,2,9],'side',['soft','labeled'],[0,'labeled'],['light','labeled']],
['wings','香烤鸡翅','side',1400,'wings','浓郁',[8,9],'side',['crispy','labeled'],[1,'labeled'],['rich','labeled']],
['tea','柠檬茶','drink',600,'tea','清爽',[1,2,11],'drink',['refreshing','labeled'],[0,'labeled'],['light','labeled']],
['coffee','醇香咖啡','drink',1000,'coffee','浓郁',[2,11],'drink',['refreshing','labeled'],[0,'labeled'],['rich','unknown']],
['milk','鲜奶饮品','drink',1000,'milk','浓郁',[11],'drink',['soft','labeled'],[0,'labeled'],['rich','unknown']],
['juice','橙味果饮','drink',900,'juice','清爽',[2,11],'drink',['refreshing','labeled'],[0,'labeled'],['light','labeled']],
['sundae','草莓风味冰淇淋','other',1000,'sundae','清爽',[2,10],'other',['soft','labeled'],[0,'labeled'],['light','labeled']],
['pie','香甜苹果派','other',700,'pie','香脆',[2,10],'other',['crispy','labeled'],[0,'labeled'],['rich','unknown']],
['cake','可可小蛋糕','other',1100,'cake','浓郁',[10],'other',['soft','labeled'],[0,'labeled'],['rich','unknown']],
['solo','香脆单人组合','other',3200,'crispy','香脆',[0,3],'other',['crispy','unknown'],[null,'unknown'],[null,'unknown']],
['duo','双人分享组合','other',6200,'burger','浓郁',[4],'other',['soft','unknown'],[null,'unknown'],[null,'unknown']],
['kids','童趣小份组合','other',2800,'corn','清爽',[5],'other',['soft','unknown'],[0,'labeled'],[null,'unknown']],
['light','轻巧组合示例','other',null,'wrap','清爽',[6],'other',['soft','unknown'],[null,'unknown'],[null,'unknown']],
['pair','主食小食搭配','other',2600,'fries','香脆',[0,1],'other',['crispy','unknown'],[null,'unknown'],[null,'unknown']],
/* 新增：T11 精确 40 元回归所需的「一人 34 元整餐」；rank 设高，只在被明确加入餐单时使用，不会挤掉默认推荐 */
['solo34','一人食组合','other',3400,'crispy','香脆',[0,3],'other',['crispy','unknown'],[null,'unknown'],[null,'unknown']],
/* 新增：第 6 题「只换一份」的可替换小食 */
['soup','暖心蔬菜汤','side',700,'corn','清爽',[1,2,9],'side',['soft','labeled'],[0,'labeled'],['light','labeled']]
];
const spec=(id,label,options)=>({id,label,required:true,options:options.map(([id,label])=>({id,label}))});
const products=rows.map(([id,name,role,minor,art,taste,cs,family,tex,spice,rich])=>({
 id,name,role,price:minor===null?null:{minor,currency:'CNY'},art,tasteTags:[taste],family,
 categoryIds:cs.map(i=>'c'+i),source:'demo',
 description:role==='main'?'一口满足，熟悉的好滋味':role==='drink'?'杯型和温度由你确认':id==='light'?'分类演示，不提供热量结论':'让这一餐多一点滋味',
 /* 生活化口味翻译（C1）的可追溯属性。只有 evidence==='labeled' 的维度才有资格参与匹配；
    unknown 既不等于“不匹配”，也不当作“已符合”。香脆不能代替辣度，不油腻不等于低脂或健康。 */
 attributes:{texture:{label:tex[0],evidence:tex[1]},spice:{level:spice[0],evidence:spice[1]},richness:{level:rich[0],evidence:rich[1]},flavor:{labels:[taste],evidence:taste==='清爽'?'labeled':'unknown'}},
 /* C3 新品证据：演示目录没有任何官方新品标记，因此只允许说“换一款”，不允许说“新品”。 */
 newProductEvidence:{source:'demo',officialFlag:false,validFrom:null,validTo:null,checkedAt:null},
 specGroups:role==='drink'?[spec('size','杯型',[['m','中杯'],['l','大杯']]),spec('temp','温度',id==='coffee'||id==='milk'?[['hot','热'],['ice','冰']]:[['ice','冰'],['room','常温']])]:role==='other'&&['solo','duo','kids','pair','solo34'].includes(id)?[spec('drink','组合饮品',[['tea','柠檬茶·中杯·冰'],['juice','橙味果饮·中杯·常温']])]:[]
}));
const evidence={crispy:['chicken','wheat','egg','milk'],beef:['beef','wheat','milk'],fish:['fish','wheat','egg'],wrap:['chicken','wheat','egg'],fries:[],nuggets:['chicken','wheat'],corn:[],wings:['chicken'],tea:[],coffee:[],milk:['milk'],juice:[],sundae:['milk'],pie:['wheat'],cake:['wheat','egg','milk'],solo:['chicken','wheat','egg','milk'],duo:['beef','wheat','milk'],kids:['chicken','wheat'],light:null,pair:['chicken','wheat','egg','milk'],solo34:['chicken','wheat','egg','milk'],soup:[]};
const rank={crispy:0,beef:2,fish:3,wrap:4,fries:0,corn:2,nuggets:3,wings:4,tea:0,juice:1,milk:2,coffee:3,solo:5,duo:5,kids:8,pair:6,solo34:9,soup:6};
const bundles={solo:{main:1,side:1,drink:1},duo:{main:2,side:1,drink:2},kids:{main:1,side:1,drink:1},pair:{main:1,side:1},solo34:{main:1,side:1,drink:1}};
for(const p of products){p.recommendable=p.id!=='kids';p.ingredientTags=evidence[p.id];p.rank=rank[p.id]||0;if(bundles[p.id])p.coverage=bundles[p.id];p.ingredientEvidence='虚构演示成分，不作真实过敏原保证';}
/* 演示省钱方案：全部 source=demo。界面必须显示“演示”，不得声称真实最低价，也不得自动领券或凑单。 */
const demoOffers=[
 {id:'demo-coupon-a',kind:'coupon',title:'演示券 A',discountMinor:-800,eligibility:'演示：任意单消费满 30 元可用',expiresAt:null,source:'demo',stackable:false},
 {id:'demo-coupon-b',kind:'coupon',title:'演示券 B',discountMinor:-500,eligibility:'演示：仅限指定商品，不可与其他券叠加',expiresAt:null,source:'demo',stackable:false}
];
const api={categories,products,demoOffers};if(typeof module!=='undefined')module.exports=api;else root.McDemo=api;
})(typeof window!=='undefined'?window:globalThis);