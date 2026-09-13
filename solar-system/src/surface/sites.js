import { physicalData } from '../physical-scale.js';

const art = '地表艺术重建 · gpt-image-2.5-sunburst';
const reconstructed = 'AI 艺术重建 · 非实测地形';
const common = {
  date: '2026-09-12T12:00:00Z', panoramaCenter: 180, initialHeading: 180, initialPitch: 0,
  provenance: reconstructed, credit: art, referenceSolarAltitude: 25, nightFloor: .025,
  coordinateNote: '拟定观景坐标；地貌与全景朝向为示意，不能用于测量。',
};

export const additionalLandingSites = Object.freeze({
  mars: {
    ...common, id:'mars', body:'Mars', name:'火星', title:'盖迪兹谷 · 夏普山麓', english:'GEDIZ VALLIS',
    radiusKm:physicalData.mars.radiusKm, latitude:-4.85, longitude:137.41,
    parent:'Sun', parentName:'太阳', parentRadiusKm:physicalData.sun.radiusKm, parentTexture:null,
    texture:'/surface/mars.webp', mobileTexture:'/surface/mars-4k.webp', textureWidth:8192,
    provenance:'好奇号 · 实拍拼接 / AI 补绘', credit:'NASA / JPL-Caltech / MSSS · PIA26410 · 缺测地面 gpt-image-2.5-sunburst',
    source:'https://www.jpl.nasa.gov/images/pia26410-curiositys-view-within-gediz-vallis-channel/',
    description:'好奇号在盖迪兹谷拍下的层状岩壁、碎石与古老河道，远处是夏普山的坡地。',
    notes:'原图由 2024 年 9 月 21–22 日的 341 张照片拼接，色彩经地球白平衡调整。上方已观测地形由原片合成保留；未拍到的脚下及车体区域，经实拍与全景构图双图参考生成补绘。天空替换为散射示意。坐标只定位盖迪兹谷附近，非精确车位；投影与朝向近似。',
    atmosphere:'mars', solarDay:1.02749, initialHeading:100, panoramaCenter:180,
  },
  io: {
    ...common, id:'io', body:'Io', name:'木卫一', title:'朝木星侧 · 火山平原', english:'IO VOLCANIC PLAIN',
    radiusKm:physicalData.io.radiusKm, latitude:0, longitude:55,
    parent:'Jupiter', parentName:'木星', parentRadiusKm:physicalData.jupiter.radiusKm,
    parentTexture:'/solar-system/textures/2k_jupiter.jpg', texture:'/surface/io.webp',
    source:'https://science.nasa.gov/jupiter/jupiter-moons/io/facts/',
    description:'硫质沉积覆盖的平原与深色熔岩流交错，木星悬在朝向主星的一侧。',
    notes:'依据探测影像中的火山、硫质沉积与熔岩地貌重建。没有真实着陆照片，熔岩裂隙位置与亮度变化是艺术示意，不对应特定正在喷发的火山。使用理想潮汐锁定坐标，以朝木星方向为零经线。',
    solarDay:1.77, activity:'lava', initialHeading:235, panoramaCenter:180,
  },
  titan: {
    ...common, id:'titan', body:'Titan', name:'土卫六', title:'惠更斯着陆区', english:'HUYGENS LANDING REGION',
    radiusKm:physicalData.titan.radiusKm, latitude:-10.3, longitude:192.3,
    parent:'Saturn', parentName:'土星', parentRadiusKm:physicalData.saturn.radiusKm,
    parentTexture:'/solar-system/textures/2k_saturn.jpg', texture:'/surface/titan.webp',
    source:'https://www.esa.int/ESA_Multimedia/Images/2005/01/First_colour_view_of_Titan_s_surface',
    description:'浓厚的橙色雾霾笼罩平原，圆润的水冰卵石散布在暗色沉积物上。',
    notes:'依据惠更斯号照片的地貌特征进行文生图重建，没有逐像素沿用原片。着陆区并非甲烷湖面。大气为可见光散射示意，遮蔽星空与土星圆面；太阳只表现为模糊辉光。轨道使用本地 JPL 星历，IAU 自转独立计算；未额外拟合物理天平动。',
    atmosphere:'titan', solarDay:15.98, obscuredParent:true, referenceSolarAltitude:20,
  },
  enceladus: {
    ...common, id:'enceladus', body:'Enceladus', name:'土卫二', title:'南极 · 虎纹裂缝', english:'SOUTH POLAR FRACTURES',
    radiusKm:physicalData.enceladus.radiusKm, latitude:-75, longitude:30,
    parent:'Saturn', parentName:'土星', parentRadiusKm:physicalData.saturn.radiusKm,
    parentTexture:'/solar-system/textures/2k_saturn.jpg', texture:'/surface/enceladus.webp',
    source:'https://science.nasa.gov/mission/cassini/science/enceladus/',
    description:'水冰山脊被长裂缝切开，远处的冰粒喷流从南极地形上方伸向太空。',
    notes:'虎纹裂缝与喷流有卡西尼号观测依据，近地视野和喷口位置为艺术重建。喷流运动是展示近似。轨道使用本地 JPL 星历和独立 IAU 自转姿态；土星环按赤道平面绘制，在这里接近侧视，不是横跨天空的宽环。',
    solarDay:1.371, activity:'ice', initialHeading:180, referenceSolarAltitude:10,
  },
  pluto: {
    ...common, id:'pluto', body:'Pluto', name:'冥王星', title:'斯普特尼克平原边缘', english:'SPUTNIK PLANITIA MARGIN',
    radiusKm:physicalData.pluto.radiusKm, latitude:18, longitude:178,
    parent:'Charon', parentName:'冥卫一', parentRadiusKm:physicalData.charon.radiusKm,
    parentTexture:'/solar-system/textures/2k_charon.jpg', texture:'/surface/pluto.webp',
    source:'https://www.nasa.gov/missions/nasa-video-soars-over-plutos-majestic-mountains-and-icy-plains/',
    description:'氮冰平原与水冰山脉相接，远日世界的地平线向两侧展开。',
    notes:'依据新视野号地貌资料重建，没有真实着陆照片或逐像素高程还原。这里在背向冥卫一的一侧，冥卫一位于地平线下。太阳按实际视大小显示，曝光为展示调整；稀薄大气的微弱近地霾层为示意。冥卫一位置采用本地 JPL 星历，自转姿态使用 IAU 模型。',
    atmosphere:'pluto', solarDay:6.388, referenceSolarAltitude:20,
  },
  miranda: {
    ...common, id:'miranda', body:'Miranda', name:'天卫五', title:'维罗纳断崖附近', english:'VERONA RUPES REGION',
    radiusKm:physicalData.miranda.radiusKm, latitude:-18, longitude:316,
    parent:'Uranus', parentName:'天王星', parentRadiusKm:physicalData.uranus.radiusKm,
    parentTexture:'/solar-system/textures/2k_uranus.jpg', texture:'/surface/miranda.webp',
    source:'https://science.nasa.gov/uranus/moons/miranda/',
    description:'层状冰岩断崖从碎裂的平原升起，崖脚散落着棱角分明的坡积物。',
    notes:'旅行者 2 号影像提供地貌依据，近地轮廓、崖高和距离为艺术构建，不是测量模型。使用 IAU 极轴与自转相位，包括主要章动项；轨道以平均距离、朝向主星近似，不用于精确日食预报。',
    solarDay:1.414, initialPitch:9, referenceSolarAltitude:15,
  },
  mercury: {
    ...common, id:'mercury', body:'Mercury', name:'水星', title:'卡洛里盆地 · 内侧平原', english:'CALORIS BASIN PLAINS',
    radiusKm:physicalData.mercury.radiusKm, latitude:30, longitude:160,
    parent:'Sun', parentName:'太阳', parentRadiusKm:physicalData.sun.radiusKm, parentTexture:null,
    texture:'/surface/mercury.webp',
    source:'https://science.nasa.gov/mercury/facts/',
    description:'古老火山平原上的撞击坑、褶皱山脊与灰褐色碎岩，远处是盆地边缘的低山。',
    notes:'信使号等轨道影像提供地貌依据，落地全景为艺术重建。水星只有极稀薄的外逸层，没有蓝天、云雾或风沙。自转约 58.65 地球日，太阳日约 176 地球日；太阳视大小随椭圆轨道变化。表面不模拟成熔岩海。',
    solarDay:176, referenceSolarAltitude:20,
  },
});

export const landableBodyIds = Object.freeze(['moon','europa',...Object.keys(additionalLandingSites)]);
