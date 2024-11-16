import {chromium} from "playwright";
import chalk from 'chalk';


// 修改为任意一个章节的 url。
const url_login = "https://mooc.mooc.ucas.edu.cn/mooc-ans/mycourse/studentstudy?chapterId=345038&courseId=350140000025066&clazzid=350140000019254&cpi=350140000171596&enc=919ec89e87c2360be02eb6a61466e889&mooc2=1&openc=e79e1f2b5e8a5d0009ce98090ebd0633";
const edge_path = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';  // 修改为 Microsoft Edge 浏览器的路径
const username = '';   // 手机号码
const password = '';    // 密码


async function deal_video(page) {
    // dirty hack: 利用 playwright focus() 的自动等待，来保证 frames() 都加载完成 。  （也可以用 waitFor）
    await page.frameLocator('#iframe').locator('iframe[src*="video"]').first().focus();
    let video_iframes = [];
    const iframes = page.frames();
    for (let frame of iframes) {
        // console.log(frame.url());
        if (frame.url().includes('video')) {
            video_iframes.push(frame);
        }
    }
    console.log(chalk.whiteBright(`   Found ${video_iframes.length} iframes with src containing "video".`));

    for (let i = 0; i < video_iframes.length; i++) {
        const video_iframe = video_iframes[i];
        const job_id = await video_iframe.parentFrame().locator('iframe[src*="video"]').nth(i).getAttribute("jobid");
        // 添加监听
        page.on('response', async (response) => {
            if (new RegExp(`^https?://mooc.mooc.ucas.edu.cn/mooc-ans/multimedia/log/.*jobid=${job_id}`).test(response.url())) {
                const data = await response.json();
                if (data.isPassed) {
                    // 注意这个需要设置在 iframe 里面 。如果直接设置 window.isPassedVideo ，在 iframe 里是看不到 isPassedVideo 的。
                    await video_iframe.evaluate(() => window.isPassedVideo = true);
                }
            }
        });


        const video = await video_iframe.locator('video');
        await video.evaluate(video => {
            video.playbackRate = 1.9; // 设置播放速度为2 的话，可能有些 bug ，实际播放完，但是浏览器提交的请求并不一定成功。
            /*  抓包得到的参数：（代码中设置播放速度为 2 有时有 bug 和原因估计和 playingTime 有关系）
                clazzId: 350140000019254
                playingTime: 66    # 关键。
                duration: 67    #没用
                clipTime: 0_67
                objectId: b99f39f0eb86b4e790727ef40d5a8f24
                otherInfo: nodeId_345022-cpi_xxxxxxxxxxx-rt_d-ds_1-ff_1-vt_1-v_5-enc_bb13fbacb4afaf2a90bf227xxxxxx
                courseId: 350140000025066
                jobid: 1633175390173294
                userid: 337541389
                isdrag: 4
                view: pc
                enc: 3e7cd9dba59d7ab25b98573bbf49d374
                rt: 0.9
                videoFaceCaptureEnc:
                dtype: Video
                _t: 1731661155718
             */
            video.muted = true; // 设置静音
            video.play();

            // 添加事件监听器，确保视频在鼠标离开时继续播放；
            video.addEventListener('pause', () => {
                video.play();
            });

            // 添加一个定时器来检查 isPassed 变量
            const checkIsPassed = setInterval(() => {
                if (window.isPassedVideo) {
                    clearInterval(checkIsPassed);
                    video.dispatchEvent(new Event('ended'));
                }
            }, 1000);

        });
        // 等待视频播放完成
        await video.evaluateHandle(video => new Promise(resolve => video.onended = resolve));

        console.log(chalk.greenBright("       Video has finished playing"));
    }

}


async function deal_pdf(page) {
    // dirty hack: 利用 playwright focus() 的自动等待，来解决 count() 遇到的 "Execution context was destroyed" 问题  以及 count() 不全的问题。   也可以用 waitFor()
    await page.frameLocator('#iframe').locator('iframe[src*="pdf"]').first().focus();
    const iframes = await page.frameLocator('#iframe').locator('iframe[src*="pdf"]');
    const iframeCount = await iframes.count();
    console.log(chalk.whiteBright(`   Found ${iframeCount} iframes with src containing "pdf".`));

   const scriptContent_iframe = (await page.frameLocator('#iframe').locator('script').evaluateAll(scripts => scripts.map(script => script.innerText))).join('\n');

    // Extract stu_CourseId and stu_clazzId using regular expressions
    let stu_CourseId = await page.locator('input[id="curCourseId"]').getAttribute("value");
    let stu_clazzId = await page.locator('input[id="curClazzId"]').getAttribute("value");
    let jtoken = null;
    let knowledgeid = await page.locator('input[id="curChapterId"]').getAttribute("value");

    let jtokenMatch = scriptContent_iframe.matchAll(/"jtoken":"(\w+)",/g);
    let jtokens = Array.from(jtokenMatch, m => m[1]);

    // console.log(`stu_CourseId: ${stu_CourseId}`);
    // console.log(`stu_clazzId: ${stu_clazzId}`);
    // console.log(`knowledgeid: ${knowledgeid}`);

    let pdf_finish_url = 'https://mooc.mooc.ucas.edu.cn/ananas/job/document';

    // 构造请求。
    let iframe = null;
    for (let i = 0; i < iframeCount; i++) {
        if (jtokens) {
            jtoken = jtokens[i];
        }

        iframe = await iframes.nth(i);
        const job_id = await iframe.getAttribute("jobid");
        // console.log("       job_id: " + job_id);

        const response = await page.request.get(pdf_finish_url, {
            params: {
                jobid: job_id,
                knowledgeid: knowledgeid,
                courseid: stu_CourseId,
                clazzid: stu_clazzId,
                jtoken: jtoken,
                checkMicroTopic: "false",
                microTopicId: "undefined",
                _dc: Date.now(),

            },
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (data.status) {
            console.log(chalk.greenBright("       " + JSON.stringify(data)));
        }else{
            console.log(chalk.yellowBright("       " + JSON.stringify(data)));
        }
    }

}


(async () => {
    const browser = await chromium.launch({
        headless: false,
        // proxy:{
        //     "server": "http://127.0.0.1:8080" // 代理
        // },
        executablePath: edge_path  // 如果使用 playwright 安装的 chromium ，会由于没有 flash 导致播放不了视频。
    });
    const context = await browser.newContext({ignoreHTTPSErrors: true});
    const page = await context.newPage();
    await page.goto(url_login);
    await page.waitForURL(/passport.mooc.ucas.edu.cn/);
    await page.getByPlaceholder('手机号/超星号').fill(username);
    await page.getByPlaceholder('学习通密码').fill(password);
    let promise_a = page.waitForNavigation();   // waitForNavigation Deprecated ,但是没找到合适替换的。  https://github.com/microsoft/playwright/issues/20853
    await page.getByRole('button', {name: '登录'}).click();
    await promise_a;

    // 待完成的任务点(div)，下面有一个包含 jobUnfinishCount 属性的 input 标签。。
    // 需要用 waitFor() 的自动等待，来解决 count() 遇到的 "Execution context was destroyed" 问题  以及 count() 不全的问题。  也可以用 dirty hack: focus()
    // https://github.com/microsoft/playwright/issues/14278
    await page.locator('.posCatalog_select:not(.firstLayer):has(input.jobUnfinishCount):not(:has(span[title*="Quiz"]))').first().waitFor();
    // await page.getByTitle("Course ending").waitFor();   // 也可以这样 wait。
    const div_elements = page.locator('.posCatalog_select:not(.firstLayer):has(input.jobUnfinishCount):not(:has(span[title*="Quiz"]))');
    // const div_elements = await page.locator('.posCatalog_select:not(.firstLayer):not(:has(span[title*="Quiz"]))');   // 除 quiz 外的全部任务点。

    const elementsCount = await div_elements.count();

    console.log(chalk.magentaBright("待完成的任务数：" + elementsCount));


    /* 版本一：
    // 不能这么处理，div_elements.nth(i) 会漏元素。估计是 click() 之后导致页面变化，div_elements 不稳定。
    // 具体没找到解决方法。
    for (let i = 0; i < elementsCount; i++) {
        const title = await div_elements.nth(i).locator('span').first().innerText();
        console.log(chalk.blueBright("  " + title));
    }

    for (let i = 0; i < elementsCount; i++) {
        // 开始处理。
        const title = await div_elements.nth(i).locator('span').first().innerText();
        console.log("--------------------------");
        console.log(chalk.blueBright("开始处理：" + title));
        let promise_a = page.waitForNavigation();
        await div_elements.nth(i).click();
        await promise_a;
        await deal_video(page)
        await deal_pdf(page)
    }
     */

    // 版本二：
    let titles = [];  // 标题属性，用来定位。
    let full_titles = [];    // 完整标题，用来打印。
    for (let i = 0; i < elementsCount; i++) {
        const full_title = await div_elements.nth(i).locator('span').first().innerText();
        full_titles.push(full_title)
        const title = await div_elements.nth(i).locator('span').first().getAttribute("title");
        titles.push(title);
        console.log(chalk.blueBright("  " + full_title));
    }

    for (let i = 0; i < titles.length; i++) {
        // 开始处理。
        console.log(chalk.whiteBright("--------------------------"));
        console.log(chalk.blueBright("开始处理：" + full_titles[i]));
        let promise_a = page.waitForNavigation();
        await page.getByTitle(titles[i]).filter({ hasText : full_titles[i] }).click();  // 和版本一的区别，就是每次循环都会重新定位元素。
        await promise_a;
        await deal_video(page)
        await deal_pdf(page)
    }

    await browser.close();


})();





