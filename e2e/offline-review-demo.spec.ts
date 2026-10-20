import {test,expect} from "@playwright/test";
import path from "node:path";
import {pathToFileURL} from "node:url";

// This UI is a synthetic file:// demo, never a NoteMesh route, network API,
// Vault editor or credential enrollment page. It is not deployed by CI.
const ui=pathToFileURL(path.join(process.cwd(),
  "examples/offline-review-ui/index.html")).href;

test.describe("offline Thai review UI: no ownership or writing powers",()=>{
  test("explains dummy data and keeps endorsement disabled without acknowledgements",async({page})=>{
    const contacted:string[]=[];
    page.on("request",r=>contacted.push(r.url()));
    await page.goto(ui);
    await expect(page.getByRole("heading",{
      name:"ตรวจข้อเสนอแก้ไขข้อมูลลงทุน",
    })).toBeVisible();
    await expect(page.getByText("ข้อมูลตัวอย่างสมมติทั้งหมด")).toBeVisible();
    await expect(page.locator("#before")).toContainText("10");
    await expect(page.locator("#after")).toContainText("12");
    await expect(page.locator("#accept")).toBeDisabled();
    await page.locator("#confirm").fill("ทบทวนแล้ว");
    await expect(page.locator("#accept")).toBeDisabled();
    expect(contacted.every(x=>x.startsWith("file:"))).toBe(true);
  });

  test("provisional human intent can be clicked only after all explicit caveats",async({page})=>{
    await page.goto(ui);
    for(const id of ["seen-source","seen-risk","seen-owner"])
      await page.locator("#"+id).check();
    await page.locator("#confirm").fill("ทบทวนแล้ว");
    await expect(page.locator("#accept")).toBeEnabled();
    await page.locator("#accept").click();
    await expect(page.locator("#result")).toHaveAttribute("data-state","provisional-only");
    await expect(page.locator("#result")).toContainText(
      "ไม่ได้ยืนยันตัวตน ไม่ได้ลงลายเซ็น และไม่ได้บันทึก Vault",
    );
    await page.locator("#seen-owner").uncheck();
    await expect(page.locator("#accept")).toBeDisabled();
    await expect(page.locator("#result")).toHaveAttribute("data-state","pending");
  });

  test("reject and request changes never masquerade as signed approval",async({page})=>{
    await page.goto(ui);
    await page.locator("#comment").fill("ขอหลักฐานเพิ่มเติม");
    await page.locator("#request-changes").click();
    await expect(page.locator("#result")).toHaveAttribute("data-state","changes");
    await expect(page.locator("#result")).toContainText("ไม่ได้บันทึก Vault");
    await page.locator("#reject").click();
    await expect(page.locator("#result")).toHaveAttribute("data-state","rejected");
    await page.locator("#reset").click();
    await expect(page.locator("#result")).toHaveAttribute("data-state","pending");
    await expect(page.locator("#comment")).toHaveValue("");
    await expect(page.locator("#accept")).toBeDisabled();
  });

  test("is a single local offline file and does not persist decisions on reopen",async({page})=>{
    const network:string[]=[];
    page.on("request",r=>{
      if(!r.url().startsWith("file:"))network.push(r.url());
    });
    await page.goto(ui);
    await page.locator("#reject").click();
    await expect(page.locator("#result")).toHaveAttribute("data-state","rejected");
    await page.reload();
    await expect(page.locator("#result")).toHaveAttribute("data-state","pending");
    expect(network).toEqual([]);
    const storage=await page.evaluate(()=>({
      local:localStorage.length,session:sessionStorage.length,
    }));
    expect(storage).toEqual({local:0,session:0});
  });
});
