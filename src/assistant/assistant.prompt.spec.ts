import { StoreType } from '@/common/enums';
import { assistantPrompt, STORE_FOCUS, SUGGESTIONS } from './assistant.prompt';

const base = { storeName: 'متجر تجربة', assistantName: '', tone: 'friendly' as const, signedIn: false };

describe('assistant prompt', () => {
  it.each(Object.values(StoreType))('has the %s focus line and only that one', (storeType) => {
    const prompt = assistantPrompt({ ...base, storeType });
    expect(prompt).toContain(STORE_FOCUS[storeType]);
    for (const other of Object.values(StoreType).filter((t) => t !== storeType)) expect(prompt).not.toContain(STORE_FOCUS[other]);
    expect(SUGGESTIONS[storeType].length).toBeGreaterThanOrEqual(3);
  });

  it('names the focus each kind of store needs', () => {
    expect(assistantPrompt({ ...base, storeType: StoreType.WAREHOUSE })).toContain('أسعار الجملة حسب الكمية');
    expect(assistantPrompt({ ...base, storeType: StoreType.SHOWROOM })).toContain('كسر زيرو');
    expect(assistantPrompt({ ...base, storeType: StoreType.SHOP })).toContain('الصلاحية');
    expect(assistantPrompt({ ...base, storeType: StoreType.BRAND })).toContain('المقاسات والألوان والخامة');
  });

  it('asks a signed-out customer to sign in, and adds the product page as context', () => {
    expect(assistantPrompt({ ...base, storeType: StoreType.BRAND })).toContain('login');
    const p = assistantPrompt({ ...base, storeType: StoreType.BRAND, signedIn: true, product: { id: '64b000000000000000000001', title: 'تيشيرت' } });
    expect(p).toContain('get_my_orders');
    expect(p).toContain('64b000000000000000000001');
    expect(p).toContain('محتاج أتأكد من المتجر');
  });

  it('tells the model not to greet and to answer other-store questions with its scope, not as unanswered', () => {
    const p = assistantPrompt({ ...base, storeType: StoreType.BRAND });
    expect(p).toContain('متبدأش ردك بتحية');
    expect(p).toContain('لو العميل سأل عن متجر أو براند تاني');
    expect(p).toContain('متناديش cannot_answer');
  });
});
