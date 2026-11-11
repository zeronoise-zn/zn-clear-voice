// Explicit profiles: no density/product guessing and no weakening of legacy guards.
export const PRODUCT_PROFILES = Object.freeze([
  Object.freeze({id:0x48575643,name:'ClearVoice',family:'CVWH',base:0x08008000,
    maxImage:0x37800,ramEnd:0x20020000,vectorWords:118,flashKb:Object.freeze([256,512]),mcu:'STM32G474',signatureRequired:true}),
  Object.freeze({id:0x48575442,name:'HEADSET_BT',family:'BTWH',base:0x08005000,
    maxImage:0xa800,ramEnd:0x20005fe0,vectorWords:48,flashKb:Object.freeze([64]),mcu:'STM32C071G8U6',signatureRequired:false})
]);
export const profileById = id => PRODUCT_PROFILES.find(p => p.id === id);
export const profileByName = name => PRODUCT_PROFILES.find(p => p.name === name);
export const profileByFamily = family => PRODUCT_PROFILES.find(p => p.family === family);
